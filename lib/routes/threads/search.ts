import { JSDOM } from 'jsdom';
import { JSONPath } from 'jsonpath-plus';

import type { Route } from '@/types';
import { ViewType } from '@/types';
import ofetch from '@/utils/ofetch';
import { parseDate } from '@/utils/parse-date';

import { buildContent, buildHeaders, searchUrl, threadUrl } from './utils';

export const route: Route = {
    path: '/search/:query/:serpType?/:routeParams?',
    categories: ['social-media'],
    view: ViewType.SocialMedia,
    example: '/threads/search/Gemini/tags/filter=recent&minLikes=10',
    parameters: {
        query: 'Search keyword (or hashtag without `#` when `serpType` is `tags`)',
        serpType: {
            description: 'The `serp_type` query Threads expects. `default` and `tags` produce near-identical result sets; `tags` matches the URL Threads emits when a topic chip is clicked.',
            default: 'default',
            options: [
                { value: 'default', label: 'Default' },
                { value: 'tags', label: 'Tags / topic' },
            ],
        },
        routeParams: `Extra filters as a query-string. Supported keys:

| Key         | Description                                                | Accepts            | Default |
| ----------- | ---------------------------------------------------------- | ------------------ | ------- |
| \`filter\`    | Sort mode passed through to Threads                        | \`recent\`           | unset   |
| \`afterDate\` | Earliest post date (sent as Threads' \`after_date\`)         | \`YYYY-MM-DD\`       | unset   |
| \`minLikes\`  | Minimum \`like_count\` required for an item to be included | non-negative integer | \`0\`     |`,
    },
    features: {
        requireConfig: [
            {
                name: 'THREADS_COOKIE',
                optional: true,
                description: 'Threads cookie string for logged-in search results. Without it, Threads may return an empty or login-walled response.',
            },
        ],
    },
    name: 'Search',
    maintainers: ['ninboy', 'pseudoyu'],
    handler,
};

async function handler(ctx) {
    const { query } = ctx.req.param();
    const serpType = ctx.req.param('serpType') || 'default';
    const params = new URLSearchParams(ctx.req.param('routeParams') || '');
    const filter = params.get('filter') || undefined;
    const afterDate = params.get('afterDate') || undefined;
    const minLikes = Number.parseInt(params.get('minLikes') || '0', 10) || 0;

    const url = searchUrl(query, serpType, { filter, afterDate });
    const response = await ofetch(url, { headers: buildHeaders() });

    const dom = new JSDOM(response);

    let items: ThreadItem[] | null = null;
    for (const el of dom.window.document.querySelectorAll('script[data-sjs]')) {
        try {
            const data = JSONPath({
                path: '$..thread_items[*]',
                json: JSON.parse(el.textContent || ''),
            });
            if (data?.length > 0) {
                items = data as ThreadItem[];
                break;
            }
        } catch {
            // Skip invalid JSON
        }
    }

    if (!items) {
        throw new Error('Failed to extract search results from Threads response');
    }

    const options = {
        showAuthorInTitle: true,
        showAuthorInDesc: true,
        showAuthorAvatarInDesc: false,
        showQuotedInTitle: true,
        showQuotedAuthorAvatarInDesc: false,
        showEmojiForQuotesAndReply: true,
        replies: false,
    };

    const feedItems = items
        .filter((item) => item.post?.code && item.post?.user?.username)
        .filter((item) => (item.post.like_count ?? 0) >= minLikes)
        .map((item) => {
            const { title, description } = buildContent(item, options);
            return {
                title,
                description,
                author: item.post.user!.username,
                pubDate: parseDate(item.post.taken_at, 'X'),
                link: threadUrl(item.post.code),
            };
        });

    return {
        title: `Threads search: ${query}${serpType === 'tags' ? ' (#tag)' : ''}`,
        link: url,
        item: feedItems,
    };
}

interface ThreadItem {
    post: {
        user?: { username: string; profile_pic_url: string };
        taken_at: number;
        code: string;
        caption?: { text: string };
        like_count?: number;
    };
}
