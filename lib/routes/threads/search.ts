import { JSDOM } from 'jsdom';
import { JSONPath } from 'jsonpath-plus';

import type { Route } from '@/types';
import { ViewType } from '@/types';
import ofetch from '@/utils/ofetch';
import { parseDate } from '@/utils/parse-date';

import { buildContent, buildHeaders, searchUrl, threadUrl } from './utils';

export const route: Route = {
    path: '/search/:query/:serpType?/:minLikes?',
    categories: ['social-media'],
    view: ViewType.SocialMedia,
    example: '/threads/search/Gemini/tags/100',
    parameters: {
        query: 'Search keyword (or hashtag without `#` when `serpType` is `tags`)',
        serpType: {
            description: 'Search results page type. Defaults to `default`.',
            default: 'default',
            options: [
                { value: 'default', label: 'Top (mixed)' },
                { value: 'tags', label: 'Hashtag / topic' },
                { value: 'recent', label: 'Recent' },
            ],
        },
        minLikes: 'Minimum like count required for an item to be included. Defaults to `0` (no filter).',
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
    const minLikes = Number.parseInt(ctx.req.param('minLikes') || '0', 10) || 0;

    const url = searchUrl(query, serpType);
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
