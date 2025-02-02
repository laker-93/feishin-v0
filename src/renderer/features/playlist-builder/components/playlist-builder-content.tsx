import { useCallback, useEffect, useState } from 'react';
import { Box, Text, Textarea, Button, Grid, Group, Modal, TextInput, Table } from '@mantine/core';
import { Dropzone } from '@mantine/dropzone';
import { pymixController } from '/@/renderer/api/pymix/pymix-controller';
import { toast } from '/@/renderer/components';
import Papa from 'papaparse';
import { NavidromeController } from '/@/renderer/api/navidrome/navidrome-controller';
import { useSongList } from '/@/renderer/features/songs/queries/song-list-query';
import { CreatePlaylistResponse, SongListSort, SortOrder } from '/@/renderer/api/types';
import { closeAllModals, openContextModal, openModal } from '@mantine/modals';
import { useCreatePlaylist } from '/@/renderer/features/playlists/mutations/create-playlist-mutation';
import { useCurrentServer } from '/@/renderer/store';
import { CreatePlaylistForm } from '/@/renderer/features/playlists/components/create-playlist-form';
import { useTranslation } from 'react-i18next';
import { useAddToPlaylist } from '/@/renderer/features/playlists/mutations/add-to-playlist-mutation';

export const PlaylistBuilderContent = () => {
    const [trackList, setTrackList] = useState('');
    const { t } = useTranslation();
    const [matchedTracks, setMatchedTracks] = useState<string[]>([]);
    const [missingTracks, setMissingTracks] = useState<string[]>([]);
    const [playlistId, setPlaylistId] = useState<string | null>(null);
    const [trackIds, setTrackIds] = useState<string[]>([]);
    const addToPlaylistMutation = useAddToPlaylist({});
    const [parsedTracks, setParsedTracks] = useState<string[]>([]);
    const server = useCurrentServer();


    const handleDrop = (acceptedFiles) => {
        const file = acceptedFiles[0];
        Papa.parse(file, {
            complete: (results) => {
                const tracks = results.data.map((row) => `${row[0]} - ${row[1]}`).join('\n');
                setTrackList(tracks);
                setParsedTracks(results.data.map((row) => `${row[0]} - ${row[1]}`));
            },
            header: false,
        });
    };

    const handleSubmit = async () => {
        const tracks = trackList.split('\n').map((line) => line.trim()).filter((line) => line);
        try {
            const response = await pymixController.matchTracks({ tracks });
            setMatchedTracks(response.matchedTracks);
            setMissingTracks(response.missingTracks);
        } catch (error) {
            toast.error({ message: 'Failed to match tracks' });
            console.error('Error matching tracks:', error);
        }
    };


    const handleAddToPlaylist = useCallback(() => {
        openContextModal({
            innerProps: {
                albumId: undefined,
                artistId: undefined,
                genreId: undefined,
                songId: trackIds
            },
            modal: 'addToPlaylist',
            size: 'md',
            title: t('page.contextMenu.addToPlaylist', { postProcess: 'sentenceCase' }),
        });
    }, [trackIds]);


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
                        query: {
                            searchTerm: title,
                            startIndex: 0,
                            sortBy: SongListSort.ALBUM,
                            sortOrder: SortOrder.ASC
                        },
                        apiClientProps: { server },
                    });

                    console.log('songList for', track, songList);

                    if (songList) {
                        const matchedSong = songList.items.find((song) => 
                            song.artistName.toLowerCase().includes(artist.toLowerCase()) || 
                            artist.toLowerCase().includes(song.artistName.toLowerCase())
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
                        toast.error({
                            message: 'unable to add songs to playlist',
                            title: t('error.genericError', { postProcess: 'sentenceCase' }),
                        });
                    },
                },
            );
        }
    }, [playlistId]);




    return (
        <Box m={2} p={20}>
            <Text align="center" mb={20} size="xl" weight={700}>
                Playlist Builder
            </Text>
            <Dropzone onDrop={handleDrop} accept={["text/csv"]} multiple={false}>
                <Text align="center">Drag and drop a CSV file here, or click to select a file</Text>
            </Dropzone>
            {parsedTracks.length > 0 && (
                <Table>
                    <thead>
                        <tr>
                            <th>Track</th>
                        </tr>
                    </thead>
                    <tbody>
                        {parsedTracks.map((track, index) => (
                            <tr key={index}>
                                <td>{track}</td>
                            </tr>
                        ))}
                    </tbody>
                </Table>
            )}

            <Group position="center">
                <Button onClick={handleSubmit}>Match Tracks</Button>
            </Group>
            {matchedTracks.length > 0 && (
                <>
                    <Box mt={20}>
                        <Text size="lg" weight={700}>Matched Tracks</Text>
                        <ul>
                            {matchedTracks.map((track, index) => (
                                <li key={index}>{track}</li>
                            ))}
                        </ul>
                    </Box>
                    <Group position="center" mt={20}>
                        <Button onClick={handleBuildPlaylist}>Build Playlist</Button>
                    </Group>
                    <Group position="center" mt={20}>
                        <Button onClick={handleAddToPlaylist}>Add To Playlist</Button>
                    </Group>
                </>
            )}
            {missingTracks.length > 0 && (
                <Box mt={20}>
                    <Text size="lg" weight={700}>Missing Tracks</Text>
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