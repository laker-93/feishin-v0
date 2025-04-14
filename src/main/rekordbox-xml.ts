import * as fs from 'fs';
import * as path from 'path';
import { DOMParser } from 'xmldom';
import * as xpath from 'xpath';
import { Track, isFolder, isTrack, isTrackReference } from './rekordbox-xml-types';

export interface ParsedTrack {
    album: string | null;
    artist: string | null;
    cleanName: string | null;
    fileExtension: string;
    location: string;
    name: string | null;
    totalTime: string;
}

interface ParsedPlaylist {
    name: string;
    tracks: ParsedTrack[];
}

interface ParsedFolder {
    name: string;
    playlists: ParsedPlaylist[];
    subfolders: ParsedFolder[];
}
function sanitizeName(name: string | null): string {
    return (name || '').replace(/[/\\?%*:|"<>]/g, '-');
}
function parseNodes<T, R>(nodes: Node[], callback: (node: T) => R): R[] {
    return Array.from(nodes as T[]).map(callback);
}
function parseTrack(track: Track): ParsedTrack {
    let location = decodeURIComponent(track.getAttribute('Location') || '');
    location = location.replace(/^file:\/\/localhost/, ''); // Strip file://localhost
    location = path.resolve(location); // Resolve to absolute path (OS-agnostic)

    return {
        album: track.getAttribute('Album') || null,
        artist: track.getAttribute('Artist') || null,
        cleanName: null,
        fileExtension: path.extname(location),
        location,
        name: track.getAttribute('Name') || null,
        totalTime: track.getAttribute('TotalTime') || '', // Store as resolved path
    };
}

export function extractPlaylists(filePath: string): {
    folders: ParsedFolder[];
    playlists: ParsedPlaylist[];
    tracks: ParsedTrack[];
} {
    const rbxml = fs.readFileSync(filePath, 'utf8');
    const doc = new DOMParser().parseFromString(rbxml);

    const tracks = Array.from(
        xpath.select('/DJ_PLAYLISTS/COLLECTION/TRACK', doc) as Node[],
    ) as Element[];
    const tracksCache: Record<string, Track> = tracks.reduce(
        (cache, track) => {
            if (!isTrack(track)) throw new Error('Invalid track');
            const trackId = track.getAttribute('TrackID');
            if (trackId) cache[trackId] = track;
            return cache;
        },
        {} as Record<string, Track>,
    );

    const root = xpath.select("/DJ_PLAYLISTS/PLAYLISTS/NODE[@Name='ROOT']", doc)[0] as Element;
    if (!isFolder(root)) throw new Error('Invalid root node');

    function parsePlaylist(playlist: Element): ParsedPlaylist {
        const playlistName = sanitizeName(playlist.getAttribute('Name'));
        console.log(`Parsing playlist: ${playlistName}`);

        const trackIds = parseNodes(xpath.select('./TRACK', playlist) as Node[], (trackRef) => {
            if (!isTrackReference(trackRef)) throw new Error('Invalid trackReference');
            return (trackRef as Element).getAttribute('Key') || '';
        });

        const tracks = trackIds
            .map((id) => tracksCache[id])
            .filter((track): track is Track => !!track);

        return {
            name: playlistName,
            tracks: tracks.map(parseTrack),
        };
    }
    function parseFolder(folder: Element): ParsedFolder {
        const folderName = sanitizeName(folder.getAttribute('Name'));
        console.log(`Parsing folder: ${folderName}`);

        return {
            name: folderName,
            playlists: parseNodes(
                xpath.select("./NODE[@Type='1']", folder) as Node[],
                parsePlaylist,
            ),
            subfolders: parseNodes(
                xpath.select("./NODE[@Type='0']", folder) as Node[],
                parseFolder,
            ),
        };
    }
    return {
        folders: parseNodes(xpath.select("./NODE[@Type='0']", root) as Node[], parseFolder),
        playlists: parseNodes(xpath.select("./NODE[@Type='1']", root) as Node[], parsePlaylist),
        tracks: parseNodes(tracks, parseTrack),
    };
}
