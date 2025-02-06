import { useCallback, useEffect, useState } from 'react';
import { Box, Text, Button, Group, Table, TextInput, Divider } from '@mantine/core';
import { Dropzone } from '@mantine/dropzone';
import { pymixController } from '/@/renderer/api/pymix/pymix-controller';
import { toast } from '/@/renderer/components';
import Papa from 'papaparse';
import { NavidromeController } from '/@/renderer/api/navidrome/navidrome-controller';
import { CreatePlaylistResponse, SongListSort, SortOrder } from '/@/renderer/api/types';
import { closeAllModals, openContextModal, openModal } from '@mantine/modals';
import { useCurrentServer } from '/@/renderer/store';
import { CreatePlaylistForm } from '/@/renderer/features/playlists/components/create-playlist-form';
import { useTranslation } from 'react-i18next';
import { useAddToPlaylist } from '/@/renderer/features/playlists/mutations/add-to-playlist-mutation';

interface Track {
    artist: string;
    title: string;
}

export const PlaylistBuilderContent = () => {
    const [trackList, setTrackList] = useState<Track[]>([]);
    const { t } = useTranslation();
    const [matchedTracks, setMatchedTracks] = useState<string[]>([]);
    const [missingTracks, setMissingTracks] = useState<string[]>([]);
    const [playlistId, setPlaylistId] = useState<string | null>(null);
    const [trackIds, setTrackIds] = useState<string[]>([]);
    const addToPlaylistMutation = useAddToPlaylist({});
    const server = useCurrentServer();

    const handleDrop = (acceptedFiles) => {
        const file = acceptedFiles[0];
        Papa.parse(file, {
            complete: (results) => {
                const tracks = results.data.map((row) => ({ artist: row[0], title: row[1] }));
                setTrackList(tracks);
            },
            header: false,
        });
    };

    const handleSubmit = async () => {
        const tracks = trackList.map((track) => `${track.artist} - ${track.title}`);
        try {
            const response = await pymixController.matchTracks({ tracks });
            setMatchedTracks(response.matchedTracks);
            setMissingTracks(response.missingTracks);
        } catch (error) {
            toast.error({ message: 'Failed to match tracks' });
            console.error('Error matching tracks:', error);
        }
    };

    const handleAddTrack = (event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        const artist = formData.get('artist') as string;
        const title = formData.get('title') as string;
        if (artist && title) {
            const newTrack: Track = { artist, title };
            setTrackList([...trackList, newTrack]);
            event.currentTarget.reset();
        }
    };

    const handleAddToPlaylist = useCallback(() => {
        openContextModal({
            innerProps: {
                albumId: undefined,
                artistId: undefined,
                genreId: undefined,
                songId: trackIds,
            },
            modal: 'addToPlaylist',
            size: 'md',
            title: t('page.contextMenu.addToPlaylist', { postProcess: 'sentenceCase' }),
        });
    }, [trackIds, t]);

    const handleBuildPlaylist = () => {
        openModal({
            children: (
                <CreatePlaylistForm
                    onCancel={() => closeAllModals()}
                    onSuccess={(response: CreatePlaylistResponse) => {
                        if (response) {
                            setPlaylistId(response.id);
                        }
                        closeAllModals();
                    }}
                />
            ),
            size: 'xl',
            title: t('form.createPlaylist.title', { postProcess: 'sentenceCase' }),
        });
    };

    useEffect(() => {
        if (matchedTracks.length > 0) {
            console.log('matchedTracks', matchedTracks);
            const calculateTrackIds = async () => {
                const trackIds = [];
                for (const track of matchedTracks) {
                    const [title, artist] = track.split(' - ');
                    const songList = await NavidromeController.getSongList({
                        apiClientProps: { server },
                        query: {
                            searchTerm: title,
                            sortBy: SongListSort.ALBUM,
                            sortOrder: SortOrder.ASC,
                            startIndex: 0,
                        },
                    });

                    console.log('songList for', track, songList);

                    if (songList) {
                        const matchedSong = songList.items.find(
                            (song) =>
                                song.artistName.toLowerCase().includes(artist.toLowerCase()) ||
                                artist.toLowerCase().includes(song.artistName.toLowerCase()),
                        );
                        if (matchedSong) {
                            trackIds.push(matchedSong.id);
                        } else {
                            console.log('failed to match song', track);
                        }
                    }
                }
                setTrackIds(trackIds);
            };
            calculateTrackIds();
        }
    }, [matchedTracks, server]);

    useEffect(() => {
        console.log('playlistId', playlistId);
        if (playlistId) {
            console.log('trackIds', trackIds);
            console.log('playlistId', playlistId);
            addToPlaylistMutation.mutate(
                {
                    body: { songId: trackIds },
                    query: { id: playlistId },
                    serverId: server?.id,
                },
                {
                    onError: (err) => {
                        console.error('unable to add songs to playlist', err);
                        toast.error({
                            message: 'unable to add songs to playlist',
                            title: t('error.genericError', { postProcess: 'sentenceCase' }),
                        });
                    },
                },
            );
        }
    }, [playlistId, addToPlaylistMutation, server, t, trackIds]);

    return (
        <Box
            m={2}
            p={20}
        >
            <Text
                align="center"
                mb={20}
                size="xl"
                weight={700}
            >
                Playlist Builder
            </Text>
            <Dropzone
                accept={['text/csv']}
                multiple={false}
                onDrop={handleDrop}
            >
                <Text align="center">Drag and drop a CSV file here, or click to select a file</Text>
            </Dropzone>
            {trackList.length > 0 && (
                <>
                    <Divider my="sm" />
                    <Text
                        align="left"
                        mt={20}
                        size="lg"
                        weight={700}
                    >
                        Tracks
                    </Text>
                    <Table>
                        <thead>
                            <tr>
                                <th>Artist</th>
                                <th>Title</th>
                            </tr>
                        </thead>
                        <tbody>
                            {trackList.map((track, index) => (
                                <tr key={index}>
                                    <td>{track.artist}</td>
                                    <td>{track.title}</td>
                                </tr>
                            ))}
                        </tbody>
                    </Table>
                </>
            )}
            <form onSubmit={handleAddTrack}>
                <Group
                    grow
                    mt="md"
                    position="center"
                >
                    <TextInput
                        name="artist"
                        placeholder="Artist"
                    />
                    <TextInput
                        name="title"
                        placeholder="Title"
                    />
                    <Button type="submit">Add Track</Button>
                </Group>
            </form>
            <Group
                mt="xl"
                position="center"
            >
                <Button
                    size="lg"
                    onClick={handleSubmit}
                >
                    Match Tracks
                </Button>
            </Group>
            {matchedTracks.length > 0 && (
                <>
                    <Box mt={20}>
                        <Text
                            size="lg"
                            weight={700}
                        >
                            Matched Tracks
                        </Text>
                        <ul>
                            {matchedTracks.map((track, index) => (
                                <li key={index}>{track}</li>
                            ))}
                        </ul>
                    </Box>
                    <Group
                        mt={20}
                        position="center"
                    >
                        <Button onClick={handleBuildPlaylist}>Build Playlist</Button>
                    </Group>
                    <Group
                        mt={20}
                        position="center"
                    >
                        <Button onClick={handleAddToPlaylist}>Add To Playlist</Button>
                    </Group>
                </>
            )}
            {missingTracks.length > 0 && (
                <Box mt={20}>
                    <Text
                        size="lg"
                        weight={700}
                    >
                        Missing Tracks
                    </Text>
                    <ul>
                        {missingTracks.map((track, index) => (
                            <li key={index}>{track}</li>
                        ))}
                    </ul>
                </Box>
            )}
        </Box>
    );
};
