import * as fs from 'fs';
import * as path from 'path';
import archiver from 'archiver';
import { V2Mp3Encoder, Builder, Crate, Track, DEFAULT_SERATO_FOLDER } from 'tserato';

const defaultCrateFolder = path.join(DEFAULT_SERATO_FOLDER, 'SubCrates');

function collectTracksFromCrate(crate: Crate, out: Set<Track>, seenPaths: Set<string>) {
    // add tracks from this crate
    for (const track of crate.tracks) {
        const location = track.path;
        if (!seenPaths.has(track.path)) {
            seenPaths.add(location);
            out.add(track);
        }
    }

    // recurse into children
    for (const child of crate.children.values()) {
        collectTracksFromCrate(child, out, seenPaths);
    }
}

export function collectTracks(crateFolder = defaultCrateFolder): Set<Track> {
    const builder = new Builder();
    const mp3Encoder = new V2Mp3Encoder();

    const crates = builder.parseCratesFromRootPath(crateFolder);

    const allTracks = new Set<Track>();
    const seenPaths = new Set<string>();

    // iterate all top-level crates
    for (const crate of crates.values()) {
        collectTracksFromCrate(crate, allTracks, seenPaths);
    }

    for (const track of allTracks) {
        const meta = mp3Encoder.readMetaData(track);
        track.addTrackMeta(meta);
    }
    return allTracks;
}

function walkDir(dir: string, files: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
            walkDir(fullPath, files);
        } else if (entry.isFile() && entry.name.endsWith('.crate')) {
            files.push(fullPath);
        }
    }
    return files;
}

export async function zipCrates({
    crateFolder = defaultCrateFolder,
    outputZip, // /path/to/output/crates.zip
}: {
    crateFolder?: string;
    outputZip: string;
}) {
    const crateFiles = walkDir(crateFolder);

    console.log(`Found ${crateFiles.length} .crate files`);

    const output = fs.createWriteStream(outputZip);
    const archive = archiver('zip', { zlib: { level: 9 } });

    archive.pipe(output);

    for (const file of crateFiles) {
        // keep paths relative to SubCrates
        const relativePath = path.relative(crateFolder, file);
        archive.file(file, { name: relativePath });
    }

    await archive.finalize();

    console.log(`Zip created at: ${outputZip}`);
}
