import { useCurrentServer } from '/@/renderer/store';
import { ServerListItem } from '/@/renderer/types';
import { useState } from 'react';
import { Box, Button, Text, Modal, Group, Image, List, Radio, Divider } from '@mantine/core'; // Assuming you are using Mantine UI
import isElectron from 'is-electron';
import { toast } from '/@/renderer/components';
import { useTranslation } from 'react-i18next';
import { pymixController } from '/@/renderer/api/pymix/pymix-controller';
import RBImportEnable from '../../../../../assets/RB-import-enable-xml.png';
import RBImportSetPath from '../../../../../assets/RB-import-set-xml-path.png';
import { Link } from 'react-router-dom';

const userFS = isElectron() ? window.electron.userFs : null;
const util = isElectron() ? window.electron.utils : null;

async function syncMusicDirectory(directoryPath: string, server: ServerListItem) {
    if (userFS) {
        if (server.fbToken === undefined) {
            // todo route to action-required
            throw new Error('FB Server is not authenticated');
        }
        await userFS.sync(directoryPath, server.username, server.fbToken);
    }
}

export const DownloadContent = () => {
    const server = useCurrentServer();
    const { t } = useTranslation();
    const [isSyncing, setIsSyncing] = useState(false);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isImageModalOpen, setIsImageModalOpen] = useState(false);
    const [selectedImage, setSelectedImage] = useState<string | null>(null);
    const [exportType, setExportType] = useState<string>('rekordbox');

    if (!server || !userFS) {
        return (
            <Box
                m={2}
                p={20}
            >
                <Text
                    align="center"
                    mb={20}
                    size="md"
                >
                    To download your collection ready to import into your DJ software, you must use
                    the desktop app version of subbox.
                </Text>
                <Text
                    align="center"
                    mb={20}
                    size="md"
                >
                    See <Link to="/about">here</Link> on how to download the desktop app.
                </Text>
            </Box>
        );
    }

    const handleExport = async () => {
        setIsSyncing(true);
        const appPath = await userFS.getAppPath();
        try {
            if (exportType === 'rekordbox') {
                await pymixController.rbDownload({
                    body: { user_root: appPath },
                });
                if (server.fbToken === undefined) {
                    throw new Error('FB Server is not authenticated');
                }
                await userFS.downloadRBXML(server.fbToken);
                setIsModalOpen(true);
            } else if (exportType === 'serato') {
                await pymixController.seratoDownload({
                    body: { user_root: appPath },
                });
                if (server.fbToken === undefined) {
                    throw new Error('FB Server is not authenticated');
                }
                await userFS.downloadSeratoCrates(server.fbToken);
                setIsModalOpen(true);
            }
        } catch (error) {
            toast.error({
                message: (error as Error).message,
                title: t('error.syncError', {
                    postProcess: 'sentenceCase',
                }),
            });
            console.error('Error downloading info:', error);
        } finally {
            setIsSyncing(false);
            setIsModalOpen(false);
        }
    };

    const handleSync = async () => {
        setIsSyncing(true);
        const appPath = await userFS.getAppPath();
        const musicPath = `${appPath}/music`;
        console.log('start syncing', musicPath);
        return syncMusicDirectory(musicPath, server)
            .then(() => {
                setIsModalOpen(true);
                return null;
            })
            .catch((error) => {
                toast.error({
                    message: (error as Error).message,
                    title: t('error.syncError', {
                        postProcess: 'sentenceCase',
                    }),
                });
                console.error('Error syncing music directory:', error);
            })
            .finally(() => {
                setIsSyncing(false);
            });
    };

    const handleImageClick = (imageSrc: string) => {
        setSelectedImage(imageSrc);
        setIsImageModalOpen(true);
    };

    return (
        <Box
            m={2}
            p={20}
        >
            <Text
                align="center"
                mb={20}
                size="md"
            >
                Download any tracks on subbox that are missing on your local machine. This will sync
                the music you have uploaded to subbox to your local file system.
            </Text>
            <Group
                mb={20}
                position="center"
            >
                <Button
                    color={isSyncing ? 'gray' : 'blue'}
                    disabled={isSyncing}
                    onClick={handleSync}
                >
                    {isSyncing ? 'Downloading...' : 'Download'}
                </Button>
            </Group>
            <Modal
                opened={isModalOpen}
                title="Download Complete"
                onClose={() => setIsModalOpen(false)}
            >
                <Button
                    variant="link"
                    onClick={async () => {
                        if (util) {
                            const appPath = await userFS.getAppPath();
                            util.openItem(appPath).catch((error) => {
                                toast.error({
                                    message: (error as Error).message,
                                    title: t('error.openError', {
                                        postProcess: 'sentenceCase',
                                    }),
                                });
                            });
                        }
                    }}
                >
                    Click here to go to your download!
                </Button>
            </Modal>

            <Divider my={20} />
            <Text
                align="center"
                mb={20}
                size="xl"
                weight={700}
            >
                Export to DJ software
            </Text>
            <Text
                align="center"
                mb={20}
                size="md"
            >
                This section prepares and downloads the meta information of your music collection,
                such as playlists and ratings, to your local system. You can then follow the below
                steps to import this in to your DJ software.
            </Text>
            <Radio.Group
                name="DJSoftware"
                value={exportType}
                onChange={setExportType}
            >
                <Group
                    mt="xs"
                    position="center"
                >
                    <Radio
                        label="Rekordbox"
                        value="rekordbox"
                    />
                    <Radio
                        label="Serato"
                        value="serato"
                    />
                </Group>
            </Radio.Group>
            {exportType === 'rekordbox' && (
                <Box mt={20}>
                    <Text
                        align="center"
                        mb={20}
                        size="md"
                        weight={700}
                    >
                        How to import XML into RekordBox
                    </Text>
                    <List
                        center
                        withPadding
                        size="sm"
                    >
                        <List.Item mb={20}>
                            In Rekordbox, go to Preferences -&gt; View -&gt; check &apos;rekordbox
                            xml&apos; in Layout.
                        </List.Item>
                        <Image
                            alt="Enable RekordBox XML"
                            mb={20}
                            src={RBImportEnable}
                            style={{ cursor: 'pointer' }}
                            width={200}
                            onClick={() => handleImageClick(RBImportEnable)}
                        />
                        <List.Item mb={20}>
                            Then set the path of the XML in Preferences -&gt; Advanced -&gt;
                            Database tab -&gt; Imported Library. This must match the path of the XML
                            you downloaded from subbox on your local system.
                        </List.Item>
                        <Image
                            alt="Set RekordBox XML Path"
                            mb={20}
                            src={RBImportSetPath}
                            style={{ cursor: 'pointer' }}
                            width={200}
                            onClick={() => handleImageClick(RBImportSetPath)}
                        />
                        <List.Item>
                            You should now see an XML option in the left sidebar. Click this and
                            import the tracks and playlists into your collection.
                        </List.Item>
                    </List>
                </Box>
            )}
            {exportType === 'serato' && (
                <Box mt={20}>
                    <Text
                        align="center"
                        mb={20}
                        size="md"
                        weight={700}
                    >
                        How to import crates into Serato
                    </Text>
                    <List
                        center
                        withPadding
                        size="sm"
                    >
                        <List.Item mb={20}>
                            The subcrates.zip file contains the meta information for the crates.
                            Make sure to backup your existing crates if you want to be able to
                            restore them later.
                        </List.Item>
                        <List.Item mb={20}>
                            Take the subcrates.zip file downloaded and extract to
                            ~/Music/_Serato_/SubCrates
                        </List.Item>
                    </List>
                </Box>
            )}
            <Group
                mt={20}
                position="center"
            >
                <Button
                    color={isSyncing ? 'gray' : 'blue'}
                    disabled={isSyncing}
                    onClick={handleExport}
                >
                    {isSyncing ? 'Exporting...' : 'Export'}
                </Button>
            </Group>

            <Modal
                opened={isImageModalOpen}
                size="auto"
                onClose={() => setIsImageModalOpen(false)}
            >
                <Image
                    alt="Full Screen Image"
                    src={selectedImage}
                />
            </Modal>
        </Box>
    );
};
