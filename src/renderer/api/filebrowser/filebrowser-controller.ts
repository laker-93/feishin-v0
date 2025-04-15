import { Readable } from 'stream';
import * as tus from 'tus-js-client';
import { fbApiClient } from './filebrowser-api';
import { FBResponseType } from '/@/renderer/api/filebrowser/filebrowser-types';

const urlConfig = JSON.parse(process.env.URL_CONFIG);

type DownloadQuery = {
    filename: string;
};
type DownloadArgs = {
    query: DownloadQuery;
    responseType: FBResponseType;
};

type UploadQuery = {
    filename: string;
};
type AddToPlaylistBody = {
    fileBytes: ArrayBuffer;
};
type UploadArgs = {
    body: AddToPlaylistBody;
    query: UploadQuery;
};

type DownloadResponse = { data: Readable };

const authenticate = async (
    url: string,
    body: { password: string; username: string },
): Promise<string> => {
    const cleanServerUrl = url.replace(/\/$/, '');

    const res = await fbApiClient({ url: cleanServerUrl }).authenticate({
        body: {
            password: body.password,
            username: body.username,
        },
    });

    if (res.status !== 200) {
        throw new Error('Failed to authenticate');
    }

    return res.body.data;
};

const download = async (
    url: string,
    token: string,
    args: DownloadArgs,
): Promise<DownloadResponse> => {
    const { query, responseType } = args;

    const cleanServerUrl = url.replace(/\/$/, '');
    const res = await fbApiClient({
        responseType,
        token,
        url: cleanServerUrl,
    }).download({
        params: {
            filename: query.filename,
        },
    });

    if (res.status !== 200) {
        throw new Error(
            `Failed to download ${query.filename}. Status: ${res.status}, Headers: ${JSON.stringify(
                res.headers,
            )}`,
        );
    }
    console.log('res', res);

    return { data: res.body.data };
};

const listUploads = async (url: string, token: string): Promise<Array<String>> => {
    const cleanServerUrl = url.replace(/\/$/, '');
    const res = await fbApiClient({
        token,
        url: cleanServerUrl,
        useRaw: true,
    }).listUploads({});
    if (res.status !== 200) {
        throw new Error(`Failed to list uploads with response ${res}`);
    }
    return res.body.data.items.map((item: any) => item.path);
};

const upload = async (url: string, token: string, args: UploadArgs): Promise<null> => {
    const { body, query } = args;

    const cleanServerUrl = url.replace(/\/$/, '');
    console.log('uploading', query.filename);
    const res = await fbApiClient({
        token,
        url: cleanServerUrl,
        useRaw: true,
    }).upload({
        body: body.fileBytes,
        params: { filename: `${query.filename}?override=true` },
    });

    if (res.status !== 200) {
        throw new Error(`Failed to upload ${query.filename} with response ${res}`);
    }
    return null;
};

const tusUpload = async (
    url: string,
    token: string,
    file: File,
    progressCallback: (progress: number) => void = () => {},
): Promise<null> => {
    const fileName = file.name;
    console.log('uploading from the browser', fileName);

    // const baseUrl = 'https://browser.sub-box.net/browser'
    const baseUrl = urlConfig.url.filebrowser;
    const resourcePath = `${baseUrl}/api/tus/uploads/${fileName}?override=true`;

    const resp = await fetch(resourcePath, {
        headers: {
            'X-Auth': `${token}`,
        },
        method: 'POST',
    });
    if (resp.status !== 201) {
        throw new Error(`Failed to create an upload: ${resp.status} ${resp.statusText}`);
    }
    return new Promise((resolve, reject) => {
        console.log('uploading', fileName);
        console.log('tus object:', tus);
        const uploader = new tus.Upload(file, {
            chunkSize: 10485760 * 2,

            // endpoint: resourcePath,
            headers: {
                'X-Auth': `${token}`,
            },
            // uploadSize: fileSize,
            onError: (error) => {
                console.error('Error while uploading file:', error);
                reject(error);
            },

            onProgress: (bytesUploaded, bytesTotal) => {
                const percentage = ((bytesUploaded / bytesTotal) * 100).toFixed(2);
                console.log(`Uploaded ${bytesUploaded} of ${bytesTotal} bytes (${percentage}%)`);
                progressCallback(parseFloat(percentage));
            },
            onSuccess: () => {
                console.log('File uploaded successfully.');
                resolve(uploader.url);
            },
            uploadUrl: resourcePath,
        });
        uploader.start();
    });
};

export const fbController = {
    authenticate,
    download,
    listUploads,
    tusUpload,
    upload,
};
