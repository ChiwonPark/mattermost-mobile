// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {batchActions} from 'redux-batched-actions';

import {UserTypes} from '@mm-redux/action_types';
import {
    doPostAction,
    getNeededAtMentionedUsernames,
    receivedNewPost,
    receivedPost,
    receivedPosts,
    receivedPostsBefore,
    receivedPostsInChannel,
    receivedPostsSince,
    receivedPostsInThread,
} from '@mm-redux/actions/posts';
import {Client4} from '@mm-redux/client';
import {Posts} from '@mm-redux/constants';
import {getPost as selectPost} from '@mm-redux/selectors/entities/posts';
import {removeUserFromList} from '@mm-redux/utils/user_utils';

import {ViewTypes} from '@constants';
import {generateId} from '@utils/file';

import {getEmojisInPosts} from '@actions/views/emoji';

export function sendAddToChannelEphemeralPost(user, addedUsername, message, channelId, postRootId = '') {
    return async (dispatch) => {
        const timestamp = Date.now();
        const post = {
            id: generateId(),
            user_id: user.id,
            channel_id: channelId,
            message,
            type: Posts.POST_TYPES.EPHEMERAL_ADD_TO_CHANNEL,
            create_at: timestamp,
            update_at: timestamp,
            root_id: postRootId,
            parent_id: postRootId,
            props: {
                username: user.username,
                addedUsername,
            },
        };

        dispatch(receivedNewPost(post));
    };
}

export function setAutocompleteSelector(dataSource, onSelect, options) {
    return {
        type: ViewTypes.SELECTED_ACTION_MENU,
        data: {
            dataSource,
            onSelect,
            options,
        },
    };
}

export function selectAttachmentMenuAction(postId, actionId, text, value) {
    return (dispatch) => {
        dispatch({
            type: ViewTypes.SUBMIT_ATTACHMENT_MENU_ACTION,
            postId,
            data: {
                [actionId]: {
                    text,
                    value,
                },
            },
        });

        dispatch(doPostAction(postId, actionId, value));
    };
}

export function getPosts(channelId, page = 0, perPage = Posts.POST_CHUNK_SIZE) {
    return async (dispatch, getState) => {
        try {
            const state = getState();
            const {postsInChannel} = state.entities.posts;
            const postForChannel = postsInChannel[channelId];
            const data = await Client4.getPosts(channelId, page, perPage);
            const posts = Object.values(data.posts);
            const actions = [];

            if (posts?.length) {
                actions.push(receivedPosts(data));
                const additional = await dispatch(getPostsAdditionalDataBatch(posts));
                if (additional.data.length) {
                    actions.push(...additional.data);
                }
            }

            if (posts?.length || !postForChannel) {
                actions.push(receivedPostsInChannel(data, channelId, page === 0, data.prev_post_id === ''));
            }

            dispatch(batchActions(actions, 'BATCH_GET_POSTS'));

            return {data};
        } catch (error) {
            return {error};
        }
    };
}

export function getPost(postId) {
    return async (dispatch) => {
        try {
            const data = await Client4.getPost(postId);

            if (data) {
                const actions = [
                    receivedPost(data),
                ];

                const additional = await dispatch(getPostsAdditionalDataBatch([data]));
                if (additional.data.length) {
                    actions.push(...additional.data);
                }

                dispatch(batchActions(actions, 'BATCH_GET_POST'));
            }

            return {data};
        } catch (error) {
            return {error};
        }
    };
}

export function getPostsSince(channelId, since) {
    return async (dispatch) => {
        try {
            const data = await Client4.getPostsSince(channelId, since);
            const posts = Object.values(data.posts);

            if (posts?.length) {
                const actions = [
                    receivedPosts(data),
                    receivedPostsSince(data, channelId),
                ];

                const additional = await dispatch(getPostsAdditionalDataBatch(posts));
                if (additional.data.length) {
                    actions.push(...additional.data);
                }

                dispatch(batchActions(actions, 'BATCH_GET_POSTS_SINCE'));
            }

            return {data};
        } catch (error) {
            return {error};
        }
    };
}

export function getPostsBefore(channelId, postId, page = 0, perPage = Posts.POST_CHUNK_SIZE) {
    return async (dispatch) => {
        try {
            const data = await Client4.getPostsBefore(channelId, postId, page, perPage);
            const posts = Object.values(data.posts);

            if (posts?.length) {
                const actions = [
                    receivedPosts(data),
                    receivedPostsBefore(data, channelId, postId, data.prev_post_id === ''),
                ];

                const additional = await dispatch(getPostsAdditionalDataBatch(posts));
                if (additional.data.length) {
                    actions.push(...additional.data);
                }

                dispatch(batchActions(actions, 'BATCH_GET_POSTS_BEFORE'));
            }

            return {data};
        } catch (error) {
            return {error};
        }
    };
}

export function getPostThread(rootId, skipDispatch = false) {
    return async (dispatch) => {
        try {
            const data = await Client4.getPostThread(rootId);
            const posts = Object.values(data.posts);

            if (posts.length) {
                const actions = [
                    receivedPosts(data),
                    receivedPostsInThread(data, rootId),
                ];

                const additional = await dispatch(getPostsAdditionalDataBatch(posts));
                if (additional.data.length) {
                    actions.push(...additional.data);
                }

                if (skipDispatch) {
                    return {data: actions};
                }

                dispatch(batchActions(actions, 'BATCH_GET_POSTS_THREAD'));
            }

            return {data};
        } catch (error) {
            return {error};
        }
    };
}

export function getPostsAround(channelId, postId, perPage = Posts.POST_CHUNK_SIZE / 2) {
    return async (dispatch) => {
        try {
            const [before, thread, after] = await Promise.all([
                Client4.getPostsBefore(channelId, postId, 0, perPage),
                Client4.getPostThread(postId),
                Client4.getPostsAfter(channelId, postId, 0, perPage),
            ]);

            const data = {
                posts: {
                    ...after.posts,
                    ...thread.posts,
                    ...before.posts,
                },
                order: [ // Remember that the order is newest posts first
                    ...after.order,
                    postId,
                    ...before.order,
                ],
                next_post_id: after.next_post_id,
                prev_post_id: before.prev_post_id,
            };

            const posts = Object.values(data.posts);

            if (posts?.length) {
                const actions = [
                    receivedPosts(data),
                    receivedPostsInChannel(data, channelId, after.next_post_id === '', before.prev_post_id === ''),
                ];

                const additional = await dispatch(getPostsAdditionalDataBatch(posts));
                if (additional.data.length) {
                    actions.push(...additional.data);
                }

                dispatch(batchActions(actions, 'BATCH_GET_POSTS_AROUND'));
            }

            return {data};
        } catch (error) {
            return {error};
        }
    };
}

export function handleNewPostBatch(WebSocketMessage) {
    return async (dispatch, getState) => {
        const state = getState();
        const post = JSON.parse(WebSocketMessage.data.post);
        const actions = [receivedNewPost(post)];

        // If we don't have the thread for this post, fetch it from the server
        // and include the actions in the batch
        if (post.root_id) {
            const rootPost = selectPost(state, post.root_id);

            if (!rootPost) {
                const thread = await dispatch(getPostThread(post.root_id, true));
                if (thread.actions?.length) {
                    actions.push(...thread.actions);
                }
            }
        }

        const additional = await dispatch(getPostsAdditionalDataBatch([post]));
        if (additional.data.length) {
            actions.push(...additional.data);
        }

        return actions;
    };
}

export function getPostsAdditionalDataBatch(posts = []) {
    return async (dispatch, getState) => {
        const data = [];

        if (!posts.length) {
            return {data};
        }

        // Custom Emojis used in the posts
        // Do not wait for this as they need to be loaded one by one
        dispatch(getEmojisInPosts(posts));

        try {
            const state = getState();
            const promises = [];
            const promiseTrace = [];
            const extra = userMetadataToLoadFromPosts(state, posts);

            if (extra?.userIds.length) {
                promises.push(Client4.getProfilesByIds(extra.userIds));
                promiseTrace.push('ids');
            }

            if (extra?.usernames.length) {
                promises.push(Client4.getProfilesByUsernames(extra.usernames));
                promiseTrace.push('usernames');
            }

            if (extra?.statuses.length) {
                promises.push(Client4.getStatusesByIds(extra.statuses));
                promiseTrace.push('statuses');
            }

            if (promises.length) {
                const result = await Promise.all(promises);
                result.forEach((p, index) => {
                    if (p.length) {
                        const type = promiseTrace[index];
                        switch (type) {
                        case 'statuses':
                            data.push({
                                type: UserTypes.RECEIVED_STATUSES,
                                data: p,
                            });
                            break;
                        default: {
                            const {currentUserId} = state.entities.users;

                            removeUserFromList(currentUserId, p);
                            data.push({
                                type: UserTypes.RECEIVED_PROFILES_LIST,
                                data: p,
                            });
                            break;
                        }
                        }
                    }
                });
            }
        } catch (error) {
            // do nothing
        }

        return {data};
    };
}

function userMetadataToLoadFromPosts(state, posts = []) {
    const {currentUserId, profiles, statuses} = state.entities.users;

    // Profiles of users mentioned in the posts
    const usernamesToLoad = getNeededAtMentionedUsernames(state, posts);

    // Statuses and profiles of the users who made the posts
    const userIdsToLoad = new Set();
    const statusesToLoad = new Set();

    posts.forEach((post) => {
        const userId = post.user_id;

        if (!statuses[userId]) {
            statusesToLoad.add(userId);
        }

        if (userId === currentUserId) {
            return;
        }

        if (!profiles[userId]) {
            userIdsToLoad.add(userId);
        }
    });

    return {
        usernames: Array.from(usernamesToLoad),
        userIds: Array.from(userIdsToLoad),
        statuses: Array.from(statusesToLoad),
    };
}