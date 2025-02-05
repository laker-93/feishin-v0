import { initClient, initContract } from '@ts-rest/core';
import axios, { Method, AxiosError, AxiosResponse, isAxiosError } from 'axios';
import omitBy from 'lodash/omitBy';
import qs from 'qs';
import { pymixType } from './pymix-types';
import { resultWithHeaders } from '/@/renderer/api/utils';
import i18n from '/@/i18n/i18n';

const urlConfig = JSON.parse(process.env.URL_CONFIG);

const c = initContract();

export const contract = c.router({
    create: {
        body: pymixType._parameters.create,
        method: 'POST',
        path: 'user/create',
        responses: {
            200: resultWithHeaders(pymixType._response.create),
            500: resultWithHeaders(pymixType._response.error),
        },
    },
    deleteDuplicates: {
        body: {},
        method: 'DELETE',
        path: 'beets/duplicates',
        responses: {
            200: resultWithHeaders(pymixType._response.deleteDuplicates),
            500: resultWithHeaders(pymixType._response.error),
        },
    },
    getLibrarySize: {
        method: 'GET',
        path: 'user/library_size',
        responses: {
            200: resultWithHeaders(pymixType._response.librarySize),
            500: resultWithHeaders(pymixType._response.error),
        },
    },
    import: {
        body: pymixType._parameters.import,
        method: 'POST',
        path: 'beets/import',
        responses: {
            200: resultWithHeaders(pymixType._response.importJob),
            500: resultWithHeaders(pymixType._response.error),
        },
    },
    importProgress: {
        method: 'GET',
        path: 'beets/import/progress',
        query: pymixType._parameters.importProgress,
        responses: {
            200: resultWithHeaders(pymixType._response.beetsImportProgress),
            500: resultWithHeaders(pymixType._response.error),
        },
    },
    login: {
        body: pymixType._parameters.login,
        method: 'POST',
        path: 'user/login',
        responses: {
            200: resultWithHeaders(pymixType._response.login),
            500: resultWithHeaders(pymixType._response.error),
        },
    },
    rbDownload: {
        body: pymixType._parameters.exportJob,
        method: 'POST',
        path: 'rekordbox/export',
        responses: {
            200: resultWithHeaders(pymixType._response.exportJob),
            500: resultWithHeaders(pymixType._response.error),
        },
    },
    rbImport: {
        body: pymixType._parameters.rbImport,
        method: 'POST',
        path: 'rekordbox/import',
        responses: {
            200: resultWithHeaders(pymixType._response.importJob),
            500: resultWithHeaders(pymixType._response.error),
        },
    },
    seratoDownload: {
        body: pymixType._parameters.exportJob,
        method: 'POST',
        path: 'serato/export',
        responses: {
            200: resultWithHeaders(pymixType._response.exportJob),
            500: resultWithHeaders(pymixType._response.error),
        },
    },
    seratoImport: {
        body: {},
        method: 'POST',
        path: 'serato/import',
        responses: {
            200: resultWithHeaders(pymixType._response.seratoImport),
            500: resultWithHeaders(pymixType._response.error),
        },
    },
    sync: {
        body: pymixType._parameters.sync,
        method: 'POST',
        path: 'sync',
        responses: {
            200: resultWithHeaders(pymixType._response.sync),
            500: resultWithHeaders(pymixType._response.error),
        },
    },
    syncPlaylists: {
        body: pymixType._parameters.syncPlaylists,
        method: 'POST',
        path: 'sync/playlists',
        responses: {
            200: resultWithHeaders(pymixType._response.syncPlaylists),
            500: resultWithHeaders(pymixType._response.error),
        },
    },
    validateToken: {
        method: 'GET',
        path: 'user/is_valid_token',
        query: pymixType._parameters.isValidToken,
        responses: {
            200: resultWithHeaders(pymixType._response.isValidToken),
            500: resultWithHeaders(pymixType._response.error),
        },
    },
});

const axiosClient = axios.create({
    withCredentials: true, // Enable sending and receiving cookies
});

axiosClient.defaults.withCredentials = true;
axiosClient.defaults.paramsSerializer = (params) => {
    return qs.stringify(params, { arrayFormat: 'repeat' });
};

const parsePath = (fullPath: string) => {
    const [path, params] = fullPath.split('?');

    const parsedParams = qs.parse(params);

    // Convert indexed object to array
    const newParams: Record<string, any> = {};
    Object.keys(parsedParams).forEach((key) => {
        const isIndexedArrayObject =
            typeof parsedParams[key] === 'object' &&
            Object.keys(parsedParams[key] || {}).includes('0');

        if (!isIndexedArrayObject) {
            newParams[key] = parsedParams[key];
        } else {
            newParams[key] = Object.values(parsedParams[key] || {});
        }
    });

    const notNilParams = omitBy(newParams, (value) => value === 'undefined' || value === 'null');

    return {
        params: notNilParams,
        path,
    };
};

const shouldDelay = false;

const RETRY_DELAY_MS = 1000;
const MAX_RETRIES = 5;

const waitForResult = async (count = 0): Promise<void> => {
    return new Promise((resolve) => {
        if (count === MAX_RETRIES || !shouldDelay) resolve();

        setTimeout(() => {
            waitForResult(count + 1)
                .then(resolve)
                .catch(resolve);
        }, RETRY_DELAY_MS);
    });
};

export const pymixApiClient = () => {
    // const baseUrl = 'http://localhost:8002'
    // const baseUrl = 'https://pymix.sub-box.net'
    const baseUrl = urlConfig.url.pymix;

    return initClient(contract, {
        api: async ({ path, method, headers, body }) => {
            const { params, path: api } = parsePath(path);

            try {
                if (shouldDelay) await waitForResult();

                const result = await axiosClient.request({
                    data: body,
                    headers,
                    method: method as Method,
                    params,
                    url: `${baseUrl}/${api}`,
                });
                return {
                    body: { data: result.data, headers: result.headers },
                    headers: result.headers as any,
                    status: result.status,
                };
            } catch (e: Error | AxiosError | any) {
                if (isAxiosError(e)) {
                    if (e.code === 'ERR_NETWORK') {
                        throw new Error(
                            i18n.t('error.networkError', {
                                postProcess: 'sentenceCase',
                            }) as string,
                        );
                    }

                    const error = e as AxiosError;
                    const response = error.response as AxiosResponse;
                    return {
                        body: { data: response?.data, headers: response?.headers },
                        headers: response?.headers as any,
                        status: response?.status,
                    };
                }
                throw e;
            }
        },
        baseHeaders: {
            'Content-Type': 'application/json',
        },
        baseUrl: '',
        jsonQuery: false,
    });
};
