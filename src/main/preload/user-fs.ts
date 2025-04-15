import { ipcRenderer } from 'electron';
import { UploadTrack } from '/@/main/rekordbox-xml-types';

const sync = async (directoryPath: string, username: string, fbToken: string) => {
    console.log('invoke renderer with args: ', directoryPath, username, fbToken);
    return ipcRenderer.invoke('sync-music-directory', directoryPath, username, fbToken);
};

const uploadFromXml = async (
    xml: string,
    fbToken: string,
    username: string,
): Promise<UploadTrack[]> => {
    return ipcRenderer.invoke('upload-from-xml', xml, fbToken, username);
};

const getAppPath = async () => {
    return ipcRenderer.invoke('get-app-path');
};

const downloadRBXML = async (fbToken: string) => {
    return ipcRenderer.invoke('download-rb-xml', fbToken);
};

const downloadSeratoCrates = async (fbToken: string) => {
    return ipcRenderer.invoke('download-serato-crates', fbToken);
};

const setWatchDirectory = async () => {
    return ipcRenderer.invoke('select-watch-directory');
};

const setValue = async (key: string, value: string) => {
    return ipcRenderer.invoke('set-value', key, value);
};

export const userFs = {
    downloadRBXML,
    downloadSeratoCrates,
    getAppPath,
    setValue,
    setWatchDirectory,
    sync,
    uploadFromXml,
};

export type UserFS = typeof userFs;
