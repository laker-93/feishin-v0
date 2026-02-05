/* eslint global-require: off, no-console: off, promise/always-return: off */

/**
 * This module executes inside of electron's main process. You can start
 * electron renderer process from here and communicate with the other processes
 * through IPC.
 *
 * When running `npm run build` or `npm run build:main`, this file is compiled to
 * `./src/main.js` using webpack. This gives us some performance wins.
 */
import { access, constants, readFile, writeFile, createWriteStream } from 'fs';
import https from 'https';
import path, { join } from 'path';
import { deflate, inflate } from 'zlib';
import axios, { AxiosResponse } from 'axios';
import {
    app,
    BrowserWindow,
    shell,
    ipcMain,
    globalShortcut,
    Tray,
    Menu,
    nativeImage,
    nativeTheme,
    BrowserWindowConstructorOptions,
    protocol,
    net,
    Rectangle,
    screen,
    dialog,
} from 'electron';
import electronLocalShortcut from 'electron-localshortcut';
import log from 'electron-log/main';
import { autoUpdater } from 'electron-updater';
import fs from 'fs-extra';
import musicMetadata from 'music-metadata';
import unzipper from 'unzipper';
import { disableMediaKeys, enableMediaKeys } from './features/core/player/media-keys';
import { store } from './features/core/settings/index';
import MenuBuilder from './menu';
import {
    hotkeyToElectronAccelerator,
    isLinux,
    isMacOS,
    isWindows,
    resolveHtmlPath,
    createLog,
    autoUpdaterLogInterface,
} from './utils';
import './features';
import type { TitleTheme } from '/@/renderer/types';
import prodConfig from '../../prod-config.json';
import devConfig from '../../url-config.json';
import { extractPlaylists, ParsedTrack } from '/@/main/rekordbox-xml';
import { extractTrackName } from '/@/main/extract-track-name';
import { UploadTrack } from '/@/main/rekordbox-xml-types';
import { collectTracks, zipCrates } from '/@/main/serato-crates';
// eslint-disable-next-line import/order
const fsp = require('fs').promises;

declare module 'node-mpv';

const urlConfig = process.env.NODE_ENV === 'production' ? prodConfig : devConfig;
let authToken: string | null = null;
// Shared queues for successfully handled files and failed uploads

// Load CA certificates
// remove for dev
// workaround for UNABLE_TO_VERIFY_LEAF_SIGNATURE
// const caCertificates = fs.readFileSync('/Users/lukepurnell/workspace/traefik/certs/local-cert.pem');
// process.env.NODE_EXTRA_CA_CERTS = '/Users/lukepurnell/workspace/traefik/certs/local-cert.pem';
const httpsAgent = new https.Agent({
    rejectUnauthorized: false,
    // ca: caCertificates,
});

let watchDirectoryPath: string | null = null;

export default class AppUpdater {
    constructor() {
        log.transports.file.level = 'info';
        autoUpdater.logger = autoUpdaterLogInterface;
        autoUpdater.checkForUpdatesAndNotify();
    }
}

protocol.registerSchemesAsPrivileged([{ privileges: { bypassCSP: true }, scheme: 'feishin' }]);

process.on('uncaughtException', (error: any) => {
    console.log('Error in main process', error);
});

app.commandLine.appendSwitch('ignore-certificate-errors');
if (store.get('ignore_ssl')) {
    app.commandLine.appendSwitch('ignore-certificate-errors');
}

// From https://github.com/tutao/tutanota/commit/92c6ed27625fcf367f0fbcc755d83d7ff8fde94b
if (isLinux() && !process.argv.some((a) => a.startsWith('--password-store='))) {
    const passwordStore = store.get('password_store', 'gnome-libsecret') as string;
    app.commandLine.appendSwitch('password-store', passwordStore);
}

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let exitFromTray = false;
let forceQuit = false;

if (process.env.NODE_ENV === 'production') {
    const sourceMapSupport = require('source-map-support');
    sourceMapSupport.install();
}

const isDevelopment = process.env.NODE_ENV === 'development' || process.env.DEBUG_PROD === 'true';

if (isDevelopment) {
    require('electron-debug')();
}

const installExtensions = async () => {
    const installer = require('electron-devtools-installer');
    const forceDownload = !!process.env.UPGRADE_EXTENSIONS;
    const extensions = ['REACT_DEVELOPER_TOOLS', 'REDUX_DEVTOOLS'];

    return installer
        .default(
            extensions.map((name) => installer[name]),
            forceDownload,
        )
        .catch(console.log);
};

const RESOURCES_PATH = app.isPackaged
    ? path.join(process.resourcesPath, 'assets')
    : path.join(__dirname, '../../assets');

const getAssetPath = (...paths: string[]): string => {
    return path.join(RESOURCES_PATH, ...paths);
};

export const getMainWindow = () => {
    return mainWindow;
};

export const sendToastToRenderer = ({
    message,
    type,
}: {
    message: string;
    type: 'success' | 'error' | 'warning' | 'info';
}) => {
    getMainWindow()?.webContents.send('toast-from-main', {
        message,
        type,
    });
};

const createWinThumbarButtons = () => {
    if (isWindows()) {
        getMainWindow()?.setThumbarButtons([
            {
                click: () => getMainWindow()?.webContents.send('renderer-player-previous'),
                icon: nativeImage.createFromPath(getAssetPath('skip-previous.png')),
                tooltip: 'Previous Track',
            },
            {
                click: () => getMainWindow()?.webContents.send('renderer-player-play-pause'),
                icon: nativeImage.createFromPath(getAssetPath('play-circle.png')),
                tooltip: 'Play/Pause',
            },
            {
                click: () => getMainWindow()?.webContents.send('renderer-player-next'),
                icon: nativeImage.createFromPath(getAssetPath('skip-next.png')),
                tooltip: 'Next Track',
            },
        ]);
    }
};

const createTray = () => {
    if (isMacOS()) {
        return;
    }

    tray = isLinux()
        ? new Tray(getAssetPath('icons/icon.png'))
        : new Tray(getAssetPath('icons/icon.ico'));
    const contextMenu = Menu.buildFromTemplate([
        {
            click: () => {
                getMainWindow()?.webContents.send('renderer-player-play-pause');
            },
            label: 'Play/Pause',
        },
        {
            click: () => {
                getMainWindow()?.webContents.send('renderer-player-next');
            },
            label: 'Next Track',
        },
        {
            click: () => {
                getMainWindow()?.webContents.send('renderer-player-previous');
            },
            label: 'Previous Track',
        },
        {
            click: () => {
                getMainWindow()?.webContents.send('renderer-player-stop');
            },
            label: 'Stop',
        },
        {
            type: 'separator',
        },
        {
            click: () => {
                mainWindow?.show();
                createWinThumbarButtons();
            },
            label: 'Open main window',
        },
        {
            click: () => {
                exitFromTray = true;
                app.quit();
            },
            label: 'Quit',
        },
    ]);

    tray.on('click', () => {
        mainWindow?.show();
        createWinThumbarButtons();
    });

    tray.setToolTip('Subbox');
    tray.setContextMenu(contextMenu);
};

const createWindow = async (first = true) => {
    if (isDevelopment) {
        await installExtensions().catch(console.log);
    }

    const nativeFrame = store.get('window_window_bar_style') === 'linux';
    store.set('window_has_frame', nativeFrame);

    const nativeFrameConfig: Record<string, BrowserWindowConstructorOptions> = {
        linux: {
            autoHideMenuBar: true,
            frame: true,
        },
        macOS: {
            autoHideMenuBar: true,
            frame: true,
            titleBarStyle: 'default',
            trafficLightPosition: { x: 10, y: 10 },
        },
        windows: {
            autoHideMenuBar: true,
            frame: true,
        },
    };

    mainWindow = new BrowserWindow({
        autoHideMenuBar: true,
        frame: false,
        height: 900,
        icon: getAssetPath('icons/icon.png'),
        minHeight: 640,
        minWidth: 480,
        show: false,
        webPreferences: {
            allowRunningInsecureContent: !!store.get('ignore_ssl'),
            backgroundThrottling: false,
            contextIsolation: true,
            devTools: true,
            nodeIntegration: true,
            preload: app.isPackaged
                ? path.join(__dirname, 'preload.js')
                : path.join(__dirname, '../../.erb/dll/preload.js'),
            webSecurity: !store.get('ignore_cors'),
        },
        width: 1440,
        ...(nativeFrame && isLinux() && nativeFrameConfig.linux),
        ...(nativeFrame && isMacOS() && nativeFrameConfig.macOS),
        ...(nativeFrame && isWindows() && nativeFrameConfig.windows),
    });

    // From https://github.com/electron/electron/issues/526#issuecomment-1663959513
    const bounds = store.get('bounds') as Rectangle | undefined;
    if (bounds) {
        const screenArea = screen.getDisplayMatching(bounds).workArea;
        if (
            bounds.x > screenArea.x + screenArea.width ||
            bounds.x < screenArea.x ||
            bounds.y < screenArea.y ||
            bounds.y > screenArea.y + screenArea.height
        ) {
            if (bounds.width < screenArea.width && bounds.height < screenArea.height) {
                mainWindow.setBounds({ height: bounds.height, width: bounds.width });
            } else {
                mainWindow.setBounds({ height: 900, width: 1440 });
            }
        } else {
            mainWindow.setBounds(bounds);
        }
    }

    electronLocalShortcut.register(mainWindow, 'Ctrl+Shift+I', () => {
        mainWindow?.webContents.openDevTools();
    });

    ipcMain.on('window-dev-tools', () => {
        mainWindow?.webContents.openDevTools();
    });

    ipcMain.on('window-maximize', () => {
        mainWindow?.maximize();
    });

    ipcMain.on('window-unmaximize', () => {
        mainWindow?.unmaximize();
    });

    ipcMain.on('window-minimize', () => {
        mainWindow?.minimize();
    });

    ipcMain.on('window-close', () => {
        mainWindow?.close();
    });

    ipcMain.on('window-quit', () => {
        mainWindow?.close();
        app.exit();
    });

    ipcMain.handle('window-clear-cache', async () => {
        return mainWindow?.webContents.session.clearCache();
    });

    ipcMain.on('app-restart', () => {
        // Fix for .AppImage
        if (process.env.APPIMAGE) {
            app.exit();
            app.relaunch({
                args: process.argv.slice(1).concat(['--appimage-extract-and-run']),
                execPath: process.env.APPIMAGE,
            });
            app.exit(0);
        } else {
            app.relaunch();
            app.exit(0);
        }
    });

    ipcMain.on('global-media-keys-enable', () => {
        enableMediaKeys(mainWindow);
    });

    ipcMain.on('global-media-keys-disable', () => {
        disableMediaKeys();
    });

    ipcMain.on('player-restore-queue', () => {
        if (store.get('resume')) {
            const queueLocation = join(app.getPath('userData'), 'queue');

            access(queueLocation, constants.F_OK, (accessError) => {
                if (accessError) {
                    console.error('unable to access saved queue: ', accessError);
                    return;
                }

                readFile(queueLocation, (readError, buffer) => {
                    if (readError) {
                        console.error('failed to read saved queue: ', readError);
                        return;
                    }

                    inflate(buffer, (decompressError, data) => {
                        if (decompressError) {
                            console.error('failed to decompress queue: ', decompressError);
                            return;
                        }

                        const queue = JSON.parse(data.toString());
                        getMainWindow()?.webContents.send('renderer-restore-queue', queue);
                    });
                });
            });
        }
    });

    ipcMain.on('download-url', (_event, url: string) => {
        mainWindow?.webContents.downloadURL(url);
    });

    const globalMediaKeysEnabled = store.get('global_media_hotkeys', true) as boolean;

    if (globalMediaKeysEnabled) {
        enableMediaKeys(mainWindow);
    }

    mainWindow.loadURL(resolveHtmlPath('index.html'));

    const startWindowMinimized = store.get('window_start_minimized', false) as boolean;

    mainWindow.on('ready-to-show', () => {
        if (!mainWindow) {
            throw new Error('"mainWindow" is not defined');
        }

        if (!first || !startWindowMinimized) {
            const maximized = store.get('maximized');
            const fullScreen = store.get('fullscreen');

            if (maximized) {
                mainWindow.maximize();
            }
            if (fullScreen) {
                mainWindow.setFullScreen(true);
            }

            mainWindow.show();
            createWinThumbarButtons();
        }
    });

    mainWindow.on('closed', () => {
        ipcMain.removeHandler('window-clear-cache');
        mainWindow = null;
    });

    let saved = false;

    mainWindow.on('close', (event) => {
        store.set('bounds', mainWindow?.getNormalBounds());
        store.set('maximized', mainWindow?.isMaximized());
        store.set('fullscreen', mainWindow?.isFullScreen());

        if (!exitFromTray && store.get('window_exit_to_tray')) {
            if (isMacOS() && !forceQuit) {
                exitFromTray = true;
            }
            event.preventDefault();
            mainWindow?.hide();
        }

        if (!saved && store.get('resume')) {
            event.preventDefault();
            saved = true;

            getMainWindow()?.webContents.send('renderer-save-queue');

            ipcMain.once('player-save-queue', async (_event, data: Record<string, any>) => {
                const queueLocation = join(app.getPath('userData'), 'queue');
                const serialized = JSON.stringify(data);

                try {
                    await new Promise<void>((resolve, reject) => {
                        deflate(serialized, { level: 1 }, (error, deflated) => {
                            if (error) {
                                reject(error);
                            } else {
                                writeFile(queueLocation, deflated, (writeError) => {
                                    if (writeError) {
                                        reject(writeError);
                                    } else {
                                        resolve();
                                    }
                                });
                            }
                        });
                    });
                } catch (error) {
                    console.error('error saving queue state: ', error);
                } finally {
                    mainWindow?.close();
                    if (forceQuit) {
                        app.exit();
                    }
                }
            });
        }
    });

    mainWindow.on('minimize', (event: any) => {
        if (store.get('window_minimize_to_tray') === true) {
            event.preventDefault();
            mainWindow?.hide();
        }
    });

    if (isWindows()) {
        app.setAppUserModelId(process.execPath);
    }

    if (isMacOS()) {
        app.on('before-quit', () => {
            forceQuit = true;
        });
    }

    const menuBuilder = new MenuBuilder(mainWindow);
    menuBuilder.buildMenu();

    // Open URLs in the user's browser
    mainWindow.webContents.setWindowOpenHandler((edata) => {
        shell.openExternal(edata.url);
        return { action: 'deny' };
    });

    if (store.get('disable_auto_updates') !== true) {
        // eslint-disable-next-line
        new AppUpdater();
    }

    const theme = store.get('theme') as TitleTheme | undefined;
    nativeTheme.themeSource = theme || 'dark';
};

app.commandLine.appendSwitch('disable-features', 'HardwareMediaKeyHandling,MediaSessionService');
// app.commandLine.appendSwitch('disable-web-security');
// app.commandLine.appendSwitch('disable-features', 'BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights');
// app.commandLine.appendSwitch('ignore-certificate-errors')

// Must duplicate with the one in renderer process settings.store.ts
enum BindingActions {
    GLOBAL_SEARCH = 'globalSearch',
    LOCAL_SEARCH = 'localSearch',
    MUTE = 'volumeMute',
    NEXT = 'next',
    PAUSE = 'pause',
    PLAY = 'play',
    PLAY_PAUSE = 'playPause',
    PREVIOUS = 'previous',
    SHUFFLE = 'toggleShuffle',
    SKIP_BACKWARD = 'skipBackward',
    SKIP_FORWARD = 'skipForward',
    STOP = 'stop',
    TOGGLE_FULLSCREEN_PLAYER = 'toggleFullscreenPlayer',
    TOGGLE_QUEUE = 'toggleQueue',
    TOGGLE_REPEAT = 'toggleRepeat',
    VOLUME_DOWN = 'volumeDown',
    VOLUME_UP = 'volumeUp',
}

const HOTKEY_ACTIONS: Record<BindingActions, () => void> = {
    [BindingActions.MUTE]: () => getMainWindow()?.webContents.send('renderer-player-volume-mute'),
    [BindingActions.NEXT]: () => getMainWindow()?.webContents.send('renderer-player-next'),
    [BindingActions.PAUSE]: () => getMainWindow()?.webContents.send('renderer-player-pause'),
    [BindingActions.PLAY]: () => getMainWindow()?.webContents.send('renderer-player-play'),
    [BindingActions.PLAY_PAUSE]: () =>
        getMainWindow()?.webContents.send('renderer-player-play-pause'),
    [BindingActions.PREVIOUS]: () => getMainWindow()?.webContents.send('renderer-player-previous'),
    [BindingActions.SHUFFLE]: () =>
        getMainWindow()?.webContents.send('renderer-player-toggle-shuffle'),
    [BindingActions.SKIP_BACKWARD]: () =>
        getMainWindow()?.webContents.send('renderer-player-skip-backward'),
    [BindingActions.SKIP_FORWARD]: () =>
        getMainWindow()?.webContents.send('renderer-player-skip-forward'),
    [BindingActions.STOP]: () => getMainWindow()?.webContents.send('renderer-player-stop'),
    [BindingActions.TOGGLE_REPEAT]: () =>
        getMainWindow()?.webContents.send('renderer-player-toggle-repeat'),
    [BindingActions.VOLUME_UP]: () =>
        getMainWindow()?.webContents.send('renderer-player-volume-up'),
    [BindingActions.VOLUME_DOWN]: () =>
        getMainWindow()?.webContents.send('renderer-player-volume-down'),
    [BindingActions.GLOBAL_SEARCH]: () => {},
    [BindingActions.LOCAL_SEARCH]: () => {},
    [BindingActions.TOGGLE_QUEUE]: () => {},
    [BindingActions.TOGGLE_FULLSCREEN_PLAYER]: () => {},
};

ipcMain.on(
    'set-global-shortcuts',
    (
        _event,
        data: Record<BindingActions, { allowGlobal: boolean; hotkey: string; isGlobal: boolean }>,
    ) => {
        // Since we're not tracking the previous shortcuts, we need to unregister all of them
        globalShortcut.unregisterAll();

        for (const shortcut of Object.keys(data)) {
            const isGlobalHotkey = data[shortcut as BindingActions].isGlobal;
            const isValidHotkey =
                data[shortcut as BindingActions].hotkey &&
                data[shortcut as BindingActions].hotkey !== '';

            if (isGlobalHotkey && isValidHotkey) {
                const accelerator = hotkeyToElectronAccelerator(
                    data[shortcut as BindingActions].hotkey,
                );

                globalShortcut.register(accelerator, () => {
                    HOTKEY_ACTIONS[shortcut as BindingActions]();
                });
            }
        }

        const globalMediaKeysEnabled = store.get('global_media_hotkeys', true) as boolean;

        if (globalMediaKeysEnabled) {
            enableMediaKeys(mainWindow);
        }
    },
);

ipcMain.on(
    'logger',
    (
        _event,
        data: {
            message: string;
            type: 'debug' | 'verbose' | 'success' | 'error' | 'warning' | 'info';
        },
    ) => {
        createLog(data);
    },
);

app.on('window-all-closed', () => {
    globalShortcut.unregisterAll();
    // Respect the OSX convention of having the application in memory even
    // after all windows have been closed
    if (isMacOS()) {
        ipcMain.removeHandler('window-clear-cache');
        mainWindow = null;
    } else {
        app.quit();
    }
});

const FONT_HEADERS = [
    'font/collection',
    'font/otf',
    'font/sfnt',
    'font/ttf',
    'font/woff',
    'font/woff2',
];

const singleInstance = app.requestSingleInstanceLock();

if (!singleInstance) {
    app.quit();
} else {
    app.on('second-instance', () => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) {
                mainWindow.restore();
            } else if (!mainWindow.isVisible()) {
                mainWindow.show();
            }

            mainWindow.focus();
        }
    });

    app.whenReady()
        .then(() => {
            protocol.handle('feishin', async (request) => {
                const filePath = `file://${request.url.slice('feishin://'.length)}`;
                const response = await net.fetch(filePath);
                const contentType = response.headers.get('content-type');

                if (!contentType || !FONT_HEADERS.includes(contentType)) {
                    getMainWindow()?.webContents.send('custom-font-error', filePath);

                    return new Response(null, {
                        status: 403,
                        statusText: 'Forbidden',
                    });
                }

                return response;
            });

            createWindow();
            if (store.get('window_enable_tray', true)) {
                createTray();
            }
            app.on('activate', () => {
                // On macOS it's common to re-create a window in the app when the
                // dock icon is clicked and there are no other windows open.
                if (mainWindow === null) createWindow(false);
                else if (!mainWindow.isVisible()) {
                    mainWindow.show();
                    createWinThumbarButtons();
                }
            });
        })
        .catch(console.log);
}

// Register 'open-item' handler globally, ensuring it is only registered once
if (!ipcMain.eventNames().includes('open-item')) {
    ipcMain.handle('open-item', async (_event, path: string) => {
        return new Promise<void>((resolve, reject) => {
            access(path, constants.F_OK, (error) => {
                if (error) {
                    reject(error);
                    return;
                }

                shell.showItemInFolder(path);
                resolve();
            });
        });
    });
}

function getAppPath(): string {
    const userPath = app.getPath('userData');
    const appPath = path.join(path.dirname(userPath), 'subbox');
    return appPath;
}

ipcMain.handle('get-app-path', async () => {
    return getAppPath();
});

// todo put this in main/features/core/filebrowser
async function downloadFile(token: string, fileName: string) {
    console.log('Downloading file...');

    try {
        // const fbUrl = 'http://localhost:8081';
        // const fbUrl = 'https://browser.sub-box.net/browser';
        const fbUrl = `${urlConfig.url.filebrowser}/api/raw/downloads/${fileName}`;
        // rejectUnauthorized disable workaround for dev
        const response = await axios.get(fbUrl, {
            headers: {
                'X-Auth': `${token}`,
            },
            // todo remove this in prod. This is only needed for dev testing
            // workaround UNABLE_TO_VERIFY_LEAF_SIGNATURE for dev
            httpsAgent,

            responseType: 'stream',
        });

        // can be used in prod
        // const response = await fbController.download(fbUrl, token, {
        //    query: { filename: 'music.zip' },
        // });

        const appPath = getAppPath();
        const exportPath = path.join(appPath, fileName);
        const writer = createWriteStream(exportPath);

        response.data.pipe(writer);

        return new Promise<void>((resolve, reject) => {
            writer.on('finish', () => {
                console.log('File downloaded successfully.');
                // todo on successful download, unzip the file
                resolve();
            });
            writer.on('error', (error) => {
                console.error('Error while downloading file:', error);
                reject(error);
            });
        });
    } catch (error) {
        console.error('Error while requesting file download:', error);
        return 'error';
    }
}

const unzipAndMerge = async (zipFilePath: string, targetDirPath: string) => {
    await fs
        .createReadStream(zipFilePath)
        .pipe(unzipper.Parse())
        .on('entry', async (entry: unzipper.Entry) => {
            const filePath = path.join(targetDirPath, entry.path);
            await fs.ensureDir(path.dirname(filePath));
            if (await fs.pathExists(filePath)) {
                console.error(`File already exists: ${filePath}`);
                entry.autodrain();
            } else {
                entry.pipe(fs.createWriteStream(filePath));
            }
        })
        .promise();
    console.log('Unzip and merge completed.');
};

async function getFiles(directory: string, extensions: string[]): Promise<string[]> {
    const files = await fsp.readdir(directory, { withFileTypes: true });

    let allFiles: string[] = [];

    for (const file of files) {
        const filePath = join(directory, file.name);

        if (file.isDirectory()) {
            // Recursively read the directory
            const subFiles = await getFiles(filePath, extensions);
            allFiles = allFiles.concat(subFiles);
        } else if (file.isFile() && extensions.some((ext) => file.name.endsWith(ext))) {
            allFiles.push(filePath);
        }
    }

    return allFiles;
}

ipcMain.handle(
    'sync-music-directory',
    async (event, directoryPath: string, username: string, fbToken: string) => {
        console.log('Syncing music directory:', directoryPath);

        const musicFiles = await getFiles(directoryPath, ['.mp3', '.flac', '.wav']);

        const clientTracks = [];
        for (const file of musicFiles) {
            const metadata = await musicMetadata.parseFile(file);
            if (metadata.common.artist === undefined) {
                console.log('undefined artist');
            } else {
                clientTracks.push({
                    album: metadata.common.album,
                    artist: metadata.common.artist,
                    title: metadata.common.title,
                });
            }
        }

        // const pymixUrl = 'pymix';
        // const pymixUrl = 'https://pymix.sub-box.net';
        const pymixUrl = urlConfig.url.pymix;
        const response = await axios.post(
            `${pymixUrl}/sync`,
            {
                tracks: clientTracks,
            },
            {
                // todo remove this in prod. This is only needed for dev testing
                httpsAgent,
                params: {
                    username,
                },
                timeout: 0, // todo - re-enable timeouts, run background job and poll instead
            },
        );
        console.log('Sync response:', response.data);
        if (response.data.success) {
            console.log('Sync successful. Download file');
            await downloadFile(fbToken, 'music.zip');
            // Unzip the file and merge with the existing 'music' directory
            const appPath = getAppPath();
            const zipFilePath = path.join(appPath, 'music.zip');
            const musicDirPath = path.join(appPath);
            await unzipAndMerge(zipFilePath, musicDirPath);
        }
    },
);

ipcMain.handle(
    'upload-from-serato',
    async (event, token: string, username: string): Promise<UploadTrack[]> => {
        const tracks = collectTracks();
        const trackKeyToTrack: Record<string, ParsedTrack> = {};
        const clientTracks = [];
        for (const track of tracks) {
            if (track.trackMeta?.title === null) {
                throw new Error(`Track title is null for track: ${JSON.stringify(track)}`);
            }
            if (track.trackMeta.artist === null) {
                throw new Error(`Track artist is null for track: ${JSON.stringify(track)}`);
            }
            const cleanName = extractTrackName(
                track.trackMeta.title,
                track.trackMeta.artist,
                track.trackMeta.album ?? undefined,
            );
            const key = `${track.trackMeta.artist} - ${cleanName}`;
            const fileExtension = path.extname(track.path.toString());
            const parsedTrack: ParsedTrack = {
                album: track.trackMeta?.album,
                artist: track.trackMeta?.artist,
                cleanName,
                fileExtension,
                location: track.path,
                name: track.trackMeta?.title,
                totalTime: '',
            };
            trackKeyToTrack[key] = parsedTrack;
            clientTracks.push({
                album: track.trackMeta.album,
                artist: track.trackMeta.artist,
                fileExtension,
                title: cleanName,
            });
        }

        const fileName = 'all-crates.zip';
        const outputPath = path.join(getAppPath(), fileName);
        await zipCrates({ outputZip: outputPath });
        const baseUrl = urlConfig.url.filebrowser;
        const resourcePath = `${baseUrl}/api/resources/uploads/${fileName}?override=true`;
        const stream = fs.createReadStream(outputPath);
        const resp = await axios.post(resourcePath, stream, {
            headers: {
                'Content-Type': 'application/zip',
                'X-Auth': `${token}`,
            },
            // todo remove this in prod. This is only needed for dev testing
            httpsAgent,
        });

        if (resp.status !== 200) {
            throw new Error(`Failed to upload xml: ${resp.status} ${resp.statusText}`);
        }

        const pymixUrl = urlConfig.url.pymix;
        const response = await axios.post(
            `${pymixUrl}/sync/match_tracks`,
            {
                tracks: clientTracks,
            },
            {
                // todo remove this in prod. This is only needed for dev testing
                httpsAgent,
                params: {
                    username,
                },
            },
        );
        console.log('match tracks', response.data.tracks);
        const missingTracks = [];
        for (const track of response.data.tracks) {
            if (track.matched === false) {
                missingTracks.push(track);
            }
        }

        console.log('missing tracks to be uploaded', missingTracks);
        const uploadedTracks = [];
        const originalTrackMetaData = [];
        for (const missingTrack of missingTracks) {
            const trackName = `${missingTrack.artist} - ${missingTrack.title}`;
            const track = trackKeyToTrack[trackName];
            // const baseUrl = 'https://browser.sub-box.net/browser'
            if (!track || !track.location) {
                const msg = `Track metadata missing for "${trackName}", skipping`;
                console.warn(msg);
                throw new Error(msg);
            }

            if (!fs.existsSync(track.location)) {
                const msg = `Track file does not exist at ${track.location}, skipping "${trackName}"`;
                console.warn(msg);
                throw new Error(msg);
            }
            const baseUrl = urlConfig.url.filebrowser;
            const stagingPath = `${track.artist}/${track.album}/${track.cleanName}${track.fileExtension}`;
            const resourcePath = `${baseUrl}/api/resources/uploads/${stagingPath}?override=false`;

            const fileContents = fs.readFileSync(track.location);

            let resp: AxiosResponse | null = null;
            let shouldAbort = false;
            // if file is already there in staging path, do not re upload it
            try {
                resp = await axios.post(resourcePath, fileContents, {
                    headers: {
                        'Content-Type': 'audio/mpeg', // ADJUST THIS PER FILETYPE (img, pdf, etc)
                        'X-Auth': `${token}`,
                    },
                    // todo remove this in prod. This is only needed for dev testing
                    httpsAgent,
                });
            } catch (err) {
                if (axios.isAxiosError(err) && err.response?.status === 409) {
                    // file already exists
                    console.log(`file ${track} already exists`);
                    originalTrackMetaData.push({
                        originalAlbum: track.album,
                        originalArtist: track.artist,
                        originalName: track.name,
                        stagingLocation: stagingPath,
                        userLocation: track.location,
                    });
                } else {
                    console.warn(
                        'Upload failed; aborting remaining uploads',
                        axios.isAxiosError(err)
                            ? { data: err.response?.data, status: err.response?.status }
                            : err,
                    );
                    shouldAbort = true;
                }
            }
            if (shouldAbort) {
                break;
            }

            if (resp) {
                if (resp.status !== 200) {
                    throw new Error(
                        `Failed to create an upload: ${resp.status} ${resp.statusText}`,
                    );
                }
                originalTrackMetaData.push({
                    originalAlbum: track.album,
                    originalArtist: track.artist,
                    originalName: track.name,
                    stagingLocation: stagingPath,
                    userLocation: track.location,
                });
                uploadedTracks.push({
                    artist: track.artist,
                    title: track.cleanName,
                });
            }
        }
        console.log('uploaded tracks', uploadedTracks);
        const mapMetaResponse = await axios.post(
            `${pymixUrl}/sync/map_meta`,
            {
                tracks: originalTrackMetaData,
            },
            {
                // todo remove this in prod. This is only needed for dev testing
                httpsAgent,
                params: {
                    username,
                },
            },
        );
        console.log('map meta response: ', mapMetaResponse);

        return uploadedTracks;
    },
);

ipcMain.handle(
    'upload-from-xml',
    async (event, xml: string, token: string, username: string): Promise<UploadTrack[]> => {
        const tracks = extractPlaylists(xml).tracks;
        console.log('tracks', tracks);
        const trackKeyToTrack: Record<string, ParsedTrack> = {};
        const clientTracks = [];
        for (const track of tracks) {
            if (track.name === null) {
                throw new Error(`Track name is null for track: ${JSON.stringify(track)}`);
            }
            if (track.artist === null) {
                throw new Error(`Track artist is null for track: ${JSON.stringify(track)}`);
            }
            const cleanName = extractTrackName(track.name, track.artist, track.album ?? undefined);
            track.cleanName = cleanName;
            const key = `${track.artist} - ${track.cleanName}`;
            trackKeyToTrack[key] = track;
            clientTracks.push({
                album: track.album,
                artist: track.artist,
                fileExtension: track.fileExtension,
                title: track.cleanName,
            });
        }

        const fileName = path.basename(xml);
        const baseUrl = urlConfig.url.filebrowser;
        const resourcePath = `${baseUrl}/api/resources/uploads/${fileName}?override=true`;
        const fileContents = fs.readFileSync(xml);
        const resp = await axios.post(resourcePath, fileContents, {
            headers: {
                'Content-Type': 'application/xml',
                'X-Auth': `${token}`,
            },
            // todo remove this in prod. This is only needed for dev testing
            httpsAgent,
        });

        if (resp.status !== 200) {
            throw new Error(`Failed to upload xml: ${resp.status} ${resp.statusText}`);
        }

        const pymixUrl = urlConfig.url.pymix;
        const response = await axios.post(
            `${pymixUrl}/sync/match_tracks`,
            {
                tracks: clientTracks,
            },
            {
                // todo remove this in prod. This is only needed for dev testing
                httpsAgent,
                params: {
                    username,
                },
            },
        );
        console.log('match tracks', response.data.tracks);
        const missingTracks = [];
        for (const track of response.data.tracks) {
            if (track.matched === false) {
                missingTracks.push(track);
            }
        }

        const originalTrackMetaData = [];
        console.log('missing tracks to be uploaded', missingTracks);
        const uploadedTracks = [];
        for (const missingTrack of missingTracks) {
            const trackName = `${missingTrack.artist} - ${missingTrack.title}`;
            const track = trackKeyToTrack[trackName];
            // const baseUrl = 'https://browser.sub-box.net/browser'
            if (!track || !track.location) {
                const msg = `Track metadata missing for "${trackName}", skipping`;
                console.warn(msg);
                throw new Error(msg);
            }

            if (!fs.existsSync(track.location)) {
                const msg = `Track file does not exist at ${track.location}, skipping "${trackName}"`;
                console.warn(msg);
                throw new Error(msg);
            }
            const baseUrl = urlConfig.url.filebrowser;
            const stagingPath = `${track.artist}/${track.album}/${track.cleanName}${track.fileExtension}`;
            const resourcePath = `${baseUrl}/api/resources/uploads/${stagingPath}?override=false`;

            const fileContents = fs.readFileSync(track.location);

            let resp: AxiosResponse | null = null;
            let fileAlreadyExists = false;
            // if file is already there in staging path, do not re upload it
            try {
                resp = await axios.post(resourcePath, fileContents, {
                    headers: {
                        'Content-Type': 'audio/mpeg', // ADJUST THIS PER FILETYPE (img, pdf, etc)
                        'X-Auth': `${token}`,
                    },
                    // todo remove this in prod. This is only needed for dev testing
                    httpsAgent,
                });
            } catch (err) {
                if (axios.isAxiosError(err) && err.response?.status === 409) {
                    fileAlreadyExists = true;
                } else {
                    throw err;
                }
            }

            if (!fileAlreadyExists) {
                if (!resp || resp.status !== 200) {
                    throw new Error(
                        `Failed to create an upload: ${resp?.status} ${resp?.statusText}`,
                    );
                }

                uploadedTracks.push({
                    artist: track.artist,
                    title: track.cleanName,
                });
            }

            originalTrackMetaData.push({
                originalAlbum: track.album,
                originalArtist: track.artist,
                originalName: track.name,
                stagingLocation: stagingPath,
                userLocation: track.location,
            });
        }
        console.log('uploaded tracks', uploadedTracks);
        const mapMetaResponse = await axios.post(
            `${pymixUrl}/sync/map_meta`,
            {
                tracks: originalTrackMetaData,
            },
            {
                // todo remove this in prod. This is only needed for dev testing
                httpsAgent,
                params: {
                    username,
                },
            },
        );
        console.log('map meta response: ', mapMetaResponse);

        return uploadedTracks;
    },
);

ipcMain.handle('download-rb-xml', async (event, fbToken: string) => {
    console.log('Downloading Rekordbox XML...');

    downloadFile(fbToken, 'subbox_rb_export.xml');
    return null;
});

ipcMain.handle('download-serato-crates', async (event, fbToken: string) => {
    downloadFile(fbToken, 'SubCrates.zip');
    // todo extract to user's Music directory
    return null;
});

// Function to handle the added or changed file
async function handleFileChange(filePath: string): Promise<{ reason?: string; success: boolean }> {
    console.log(`Handling file change: ${filePath}`);
    try {
        const relativePath = path.relative(watchDirectoryPath!, filePath);
        const fileContents = fs.readFileSync(filePath);
        const baseUrl = urlConfig.url.filebrowser;

        // todo set name of upload path to path of file without the watchdir root
        const resourcePath = `${baseUrl}/api/resources/watch/${relativePath}?override=false`;

        let resp: AxiosResponse;
        // if file is already there in staging path, do not re upload it
        try {
            resp = await axios.post(resourcePath, fileContents, {
                headers: {
                    'Content-Type': 'audio/mpeg', // ADJUST THIS PER FILETYPE (img, pdf, etc)
                    'X-Auth': `${authToken}`,
                },
                // todo remove this in prod. This is only needed for dev testing
                httpsAgent,
            });
        } catch (err) {
            if (axios.isAxiosError(err) && err.response?.status === 409) {
                // file already exists
                resp = err.response; // normalize 409
            } else {
                throw err;
            }
        }

        if (resp.status !== 200) {
            const reason = `Failed to create an upload: ${resp.status} ${resp.statusText}`;
            console.error(reason);
            return { reason, success: false };
        }
        console.log(`File ${filePath} uploaded successfully.`);

        // Remove the file from the user's file system
        try {
            fs.unlinkSync(filePath); // Synchronously remove the file
            console.log(`File ${filePath} removed from the file system.`);
        } catch (unlinkError) {
            console.error(`Failed to remove file ${filePath}:`, unlinkError);
        }
        return { success: true };
    } catch (error) {
        const reason = `Error handling file ${filePath}: ${error}`;
        console.error(reason);
        return { reason, success: false };
    }
}

// Function to watch the directory for changes
function watchDirectory(directoryPath: string) {
    const fileQueue: string[] = []; // Queue to store file paths
    let isProcessing = false; // Flag to track if processing is ongoing

    // Function to process files from the queue
    const processQueue = async () => {
        if (isProcessing) return; // Skip if already processing

        isProcessing = true; // Set the flag to indicate processing has started

        while (fileQueue.length > 0) {
            const filePath = fileQueue.shift(); // Get the next file from the queue
            if (filePath) {
                try {
                    await handleFileChange(filePath); // Process the file
                } catch (error) {
                    console.error(`Error processing file ${filePath}:`, error);
                }
            }
        }

        isProcessing = false; // Reset the flag after processing
    };

    // Watch the directory for changes
    fs.watch(directoryPath, { recursive: true }, (eventType, filename) => {
        if (filename && authToken && eventType === 'rename') {
            const filePath = path.join(directoryPath, filename);
            if (fs.existsSync(filePath)) {
                // Add the file to the queue
                fileQueue.push(filePath);
                console.log(`File added to queue: ${filePath}`);
                processQueue(); // Start processing the queue
            }
        }
    });
}

ipcMain.handle('select-watch-directory', async () => {
    console.log('select watch dir');
    const result = await dialog.showOpenDialog({
        properties: ['openDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) {
        console.log('result', result);
        return null;
    }
    const directoryPath = result.filePaths[0];
    watchDirectoryPath = directoryPath;
    watchDirectory(directoryPath); // Start watching the selected directory
    console.log('call start process poll');
    return directoryPath;
});

ipcMain.handle('set-value', (event, key: string, value: string) => {
    if (key === 'authToken') {
        authToken = value;
        console.log('Auth token set');
    }
});
