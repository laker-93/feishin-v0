import { initClient, initContract } from '@ts-rest/core';
import axios, { AxiosHeaders, Method, AxiosError, AxiosResponse, isAxiosError } from 'axios';
import omitBy from 'lodash/omitBy';
import qs from 'qs';
import { z } from 'zod';
import { FBResponseType, fbType } from './filebrowser-types';
import { useAuthStore } from '/@/renderer/store';

const c = initContract();
const resultWithHeaders = <ItemType extends z.ZodTypeAny>(itemSchema: ItemType) => {
    return z.object({
        data: itemSchema,
        headers: z.instanceof(AxiosHeaders),
    });
};

export const contract = c.router({
    authenticate: {
        body: fbType._parameters.authenticate,
        method: 'POST',
        path: 'api/login',
        responses: {
            200: resultWithHeaders(fbType._response.authenticate),
            500: resultWithHeaders(fbType._response.error),
        },
    },
    download: {
        method: 'GET',
        path: 'api/raw/downloads/:filename',
        responses: {
            200: resultWithHeaders(fbType._response.download),
            500: resultWithHeaders(fbType._response.error),
        },
    },
    listUploads: {
        method: 'GET',
        path: 'api/resources/uploads',
        responses: {
            200: resultWithHeaders(fbType._response.listUploads),
            500: resultWithHeaders(fbType._response.error),
        },
    },
    upload: {
        body: fbType._parameters.fileBytes,
        method: 'POST',
        path: 'api/resources/uploads/:filename',
        responses: {
            200: resultWithHeaders(fbType._response.upload),
            500: resultWithHeaders(fbType._response.error),
        },
    },
});

const axiosClient = axios.create({});

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

export const fbApiClient = (args: {
    responseType?: FBResponseType;
    token?: string;
    url: string;
    useRaw?: boolean;
}) => {
    const { token, url, responseType = 'json', useRaw = false } = args;

    return initClient(contract, {
        api: async ({ path, method, headers, body, rawBody }) => {
            const { params, path: api } = parsePath(path);

            try {
                if (shouldDelay) await waitForResult();

                const result = await axiosClient.request({
                    data: useRaw ? rawBody : body,
                    headers: {
                        ...headers,
                        ...(token && { 'X-Auth': `${token}` }),
                    },
                    method: method as Method,
                    params,
                    responseType,
                    url: `${url}/${api}`,
                });
                return {
                    body: { data: result.data, headers: result.headers },
                    headers: result.headers as any,
                    status: result.status,
                };
            } catch (e: Error | AxiosError | any) {
                if (isAxiosError(e)) {
                    if (e.response?.status === 401) {
                        const currentServer = useAuthStore.getState().currentServer;
                        useAuthStore.getState().actions.updateServer(currentServer!.id, {
                            credential: undefined,
                            fbToken: undefined,
                            ndCredential: undefined,
                        });
                        useAuthStore.getState().actions.setCurrentServer(null);
                    }
                    if (e.code === 'ERR_NETWORK') {
                        throw new Error('network error with filebrowser');
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
        baseHeaders: {},
        baseUrl: '',
        jsonQuery: false,
    });
};
