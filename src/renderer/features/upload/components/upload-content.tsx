import { useState, useEffect } from 'react';
import {
    Text,
    Image,
    Box,
    Button,
    Group,
    Checkbox,
    Table,
    Progress,
    Select,
    Divider,
    List,
    Modal,
    Radio,
    Loader,
} from '@mantine/core';
import { Dropzone } from '@mantine/dropzone';
import { useCurrentServer } from '/@/renderer/store';
import { pymixController } from '/@/renderer/api/pymix/pymix-controller';
import { v4 as uuidv4 } from 'uuid';
import RBBackup from '../../../../../assets/RB-backup.png';
import { fbController } from '../../../api/filebrowser/filebrowser-controller';

const urlConfig = JSON.parse(process.env.URL_CONFIG);

type UploadHistoryEntry = {
    createdTime: string;
    fileName: string;
    id: string;
    processProgress: number;
    status: string;
    updatedTime: string;
    uploadProgress: number;
};

const delay = (ms: number) =>
    new Promise<void>((resolve) => {
        setTimeout(resolve, ms);
    });

const upload = async (
    filePaths: { file: File; id: string }[],
    isPublic: boolean,
    fbToken: string,
    updateUploadStatus: (
        id: string,
        status: string,
        uploadProgress: number,
        processProgress: number,
    ) => void,
) => {
    console.log('public?', isPublic);
    console.log('files', filePaths);

    // Upload files
    for (const { id, file } of filePaths) {
        try {
            const fbUrl = urlConfig.url.filebrowser;
            updateUploadStatus(id, 'Uploading', 0, 0);
            await fbController.tusUpload(fbUrl, fbToken, file, (progress) => {
                updateUploadStatus(id, 'Uploading', progress, 0);
            });
            updateUploadStatus(id, 'Uploaded', 100, 0);
        } catch (error) {
            console.error('Error uploading files:', error);
            updateUploadStatus(id, 'Upload Failed', 0, 0);
        }
    }
};

const processImport = async (
    isPublic: boolean,
    isRBImport: boolean,
    isSeratoImport: boolean,
    updateUploadStatus: (
        id: string,
        status: string,
        uploadProgress: number,
        processProgress: number,
    ) => void,
) => {
    let jobId = '';
    let importResult;
    try {
        if (isRBImport) {
            importResult = await pymixController.rbImport();
        } else if (isSeratoImport) {
            await pymixController.seratoImport();
        } else {
            importResult = await pymixController.beetsImport({ query: { public: isPublic } });
        }
    } catch (error) {
        console.error('Error during import:', error);
    }

    if (importResult?.maxLibrarySizeExceeded) {
        return 'librarySizeExceeded';
    }

    jobId = importResult?.jobId || '';

    if (!jobId) {
        return 'noJobId';
    }

    let percentageComplete = 0;
    let rounds = 0;
    let inProgress = true;
    let result = false;
    const processedFiles = [];

    const savedHistory = localStorage.getItem('uploadHistory');
    const uploadHistory: UploadHistoryEntry[] = savedHistory ? JSON.parse(savedHistory) : [];
    while (inProgress) {
        try {
            const importProgress = await pymixController.beetsImportProgress({
                query: { jobId, public: isPublic },
            });
            percentageComplete = importProgress.percentageComplete;
            inProgress = importProgress.inProgress;
            result = importProgress.result;
            console.log(
                `progress ${percentageComplete} in progress ${inProgress} result ${result} on round ${rounds}`,
            );

            // Get entries by id from uploadHistory and filter out anything with status not equal to 'Uploaded' or 'Processing'
            const filteredFileIds = uploadHistory.filter(
                (entry) => entry && (entry.status === 'Uploaded' || entry.status === 'Processing'),
            );

            for (let i = 0; i < filteredFileIds.length; i += 1) {
                const { id } = filteredFileIds[i];
                updateUploadStatus(id, 'Processing', 100, percentageComplete);
                processedFiles.push({ id });
            }

            await delay(2000); // Poll every 2 seconds
        } catch (error) {
            console.error('Error fetching progress:', error);
            break;
        }
        rounds += 1;
    }
    const outcome = result ? 'Success' : 'Processing Failed';
    processedFiles.forEach(({ id }) => {
        updateUploadStatus(id, outcome, 100, 100);
    });
    return 'success';
};

export const UploadContent = () => {
    const server = useCurrentServer();
    const [files, setFiles] = useState<File[]>([]);
    const [selectedDropZoneFiles, setSelectedDropZoneFiles] = useState<Set<number>>(new Set());
    const [uploadHistory, setUploadHistory] = useState<UploadHistoryEntry[]>(() => {
        const savedHistory = localStorage.getItem('uploadHistory');
        return savedHistory ? JSON.parse(savedHistory) : [];
    });
    const [isRBImport, setIsRBImport] = useState(false);
    const [rowsToShow, setRowsToShow] = useState(20);
    const [isImageModalOpen, setIsImageModalOpen] = useState(false);
    const [selectedImage, setSelectedImage] = useState<string | null>(null);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [fbHasUnprocessedFiles, setFbHasUnprocessedFiles] = useState(false);
    const [importType, setImportType] = useState<string>('rekordbox');
    const [isLimitExceededModalOpen, setIsLimitExceededModalOpen] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);

    useEffect(() => {
        const checkForUnprocessedFiles = async () => {
            if (server && server.fbToken) {
                try {
                    const uploads = await fbController.listUploads(
                        urlConfig.url.filebrowser,
                        server.fbToken,
                    );
                    setFbHasUnprocessedFiles(uploads.length > 0);
                } catch (error) {
                    console.log('Error listing uploads:', error);
                }
            }
        };

        checkForUnprocessedFiles();
    }, [server]);

    useEffect(() => {
        localStorage.setItem('uploadHistory', JSON.stringify(uploadHistory));
    }, [uploadHistory]);

    if (!server) {
        return null;
    }
    if (server.fbToken === undefined) {
        throw new Error('FB Server is not authenticated');
    }

    const handleDrop = async (acceptedFiles: File[]) => {
        setFiles([...files, ...acceptedFiles]);
    };

    const updateUploadStatus = (
        id: string,
        status: string,
        uploadProgress: number,
        processProgress: number,
    ) => {
        const currentTime = new Date().toISOString();
        setUploadHistory((prevHistory) => {
            const newHistory = prevHistory.map((entry) =>
                entry.id === id
                    ? {
                          ...entry,
                          processProgress,
                          status,
                          updatedTime: currentTime,
                          uploadProgress,
                      }
                    : entry,
            );
            return newHistory;
        });
    };

    const handleUpload = async () => {
        if (server.fbToken === undefined) {
            throw new Error('FB Server is not authenticated');
        }
        // Check for Rekordbox files
        const isRekordboxImport = files.some(
            (file) =>
                file.name === 'rekordbox-backup.xml' ||
                file.name === 'rekordbox_bak.zip' ||
                file.name === 'rekordbox_bak',
        );
        if (isRekordboxImport && !isRBImport) {
            setIsModalOpen(true);
            return;
        }
        const currentTime = new Date().toISOString();
        const newUploadHistory = files.map((file) => ({
            createdTime: currentTime,
            fileName: file.name,
            id: uuidv4(),
            processProgress: 0,
            status: 'Pending',
            updatedTime: currentTime,
            uploadProgress: 0,
        }));
        setUploadHistory([...uploadHistory, ...newUploadHistory]);
        try {
            setIsUploading(true);
            await upload(
                newUploadHistory.map(({ id, fileName }) => ({
                    file: files.find((f) => f.name === fileName)!,
                    id,
                })),
                isRBImport,
                server.fbToken,
                updateUploadStatus,
            );
            setIsUploading(false);
            setIsProcessing(true);
            console.log('upload history', uploadHistory);
            const result = await processImport(false, isRBImport, false, updateUploadStatus);
            if (result === 'librarySizeExceeded') {
                setIsLimitExceededModalOpen(true);
            }
            setIsProcessing(false);
        } catch (error) {
            setIsUploading(false);
            setIsProcessing(false);
            console.error('Error uploading files:', error);
        }
        setFiles([]); // Clear the files after upload
        setSelectedDropZoneFiles(new Set()); // Clear selected files after upload
    };

    const handleDropZoneFileSelect = (index: number) => {
        setSelectedDropZoneFiles((prevSelectedFiles) => {
            const newSelectedFiles = new Set(prevSelectedFiles);
            if (newSelectedFiles.has(index)) {
                newSelectedFiles.delete(index);
            } else {
                newSelectedFiles.add(index);
            }
            return newSelectedFiles;
        });
    };

    const handleRemoveSelectedDropZoneFiles = () => {
        setFiles((prevFiles) => prevFiles.filter((_, index) => !selectedDropZoneFiles.has(index)));
        setSelectedDropZoneFiles(new Set());
    };

    const formatTime = (time: string) => {
        return new Date(time).toLocaleString('en-US', { hour12: false, timeStyle: 'medium' });
    };

    const handleImageClick = (imageSrc: string) => {
        setSelectedImage(imageSrc);
        setIsImageModalOpen(true);
    };

    const handleReprocessFailedFiles = async () => {
        await processImport(false, isRBImport, false, updateUploadStatus);
    };

    const isLoading = isUploading || isProcessing;
    let isLoadingText = '';
    if (isUploading) {
        isLoadingText = 'Uploading files...';
    } else if (isProcessing) {
        isLoadingText = 'Processing files...';
    }

    return (
        <Box
            m={2}
            p={20}
            style={{ maxHeight: '700px', overflowY: 'auto' }}
        >
            <Text
                align="center"
                mb={20}
                size="md"
            >
                Upload music files to subbox.
            </Text>
            {isLoading ? (
                <Group
                    mt="md"
                    position="center"
                >
                    <Text size="md">{isLoadingText}</Text>
                    <Loader />
                </Group>
            ) : (
                <Dropzone
                    multiple
                    accept={[
                        'audio/mpeg',
                        'audio/x-flac',
                        'audio/wav',
                        'audio/x-wav',
                        'application/zip',
                        'text/xml',
                    ]}
                    style={{
                        border: '2px dashed #cccccc',
                        cursor: 'pointer',
                        padding: '20px',
                        textAlign: 'center',
                    }}
                    onDrop={handleDrop}
                >
                    <Text>Drag and drop audio files here, or click to select files</Text>
                </Dropzone>
            )}
            <Box mt={2}>
                {files.length > 0 && (
                    <Box>
                        <Text>Files to be uploaded:</Text>
                        <ul>
                            {files.map((file, index) => (
                                <li
                                    key={index}
                                    style={{ alignItems: 'center', display: 'flex' }}
                                >
                                    <Checkbox
                                        checked={selectedDropZoneFiles.has(index)}
                                        style={{
                                            borderRadius: '50%',
                                            marginRight: '10px',
                                        }}
                                        onChange={() => handleDropZoneFileSelect(index)}
                                    />
                                    {file.name}
                                </li>
                            ))}
                        </ul>
                        <Button
                            mt="md"
                            onClick={handleRemoveSelectedDropZoneFiles}
                        >
                            Remove Selected
                        </Button>
                        <Checkbox
                            checked={isRBImport}
                            label="Rekordbox import"
                            mt="md"
                            onChange={(event) => setIsRBImport(event.currentTarget.checked)}
                        />
                        <Group
                            mt="md"
                            position="center"
                        >
                            <Button onClick={handleUpload}>Upload</Button>
                        </Group>
                    </Box>
                )}
            </Box>
            {uploadHistory.length > 0 && (
                <Box mt={2}>
                    <Text>Upload History:</Text>
                    <Box>
                        <Table>
                            <thead>
                                <tr>
                                    <th>File Name</th>
                                    <th>Upload</th>
                                    <th>Process</th>
                                    <th>Status</th>
                                    <th>Created Time</th>
                                    <th>Updated Time</th>
                                </tr>
                            </thead>
                            <tbody>
                                {uploadHistory
                                    .sort(
                                        (a, b) =>
                                            new Date(b.createdTime).getTime() -
                                            new Date(a.createdTime).getTime(),
                                    )
                                    .slice(0, rowsToShow)
                                    .map((entry) => (
                                        <tr key={entry.id}>
                                            <td>{entry.fileName}</td>
                                            <td style={{ paddingRight: '20px' }}>
                                                <Progress value={entry.uploadProgress || 0} />
                                            </td>
                                            <td style={{ paddingRight: '20px' }}>
                                                <Progress value={entry.processProgress || 0} />
                                            </td>
                                            <td>{entry.status || 'Pending'}</td>
                                            <td>{formatTime(entry.createdTime)}</td>
                                            <td>{formatTime(entry.updatedTime)}</td>
                                        </tr>
                                    ))}
                            </tbody>
                        </Table>
                    </Box>
                    <Box
                        mt="md"
                        style={{ display: 'flex', justifyContent: 'flex-start' }}
                    >
                        <Select
                            data={['10', '20', '30', '40', '50']}
                            label="Rows to show"
                            size="xs"
                            value={rowsToShow.toString()}
                            onChange={(value) => setRowsToShow(Number(value))}
                        />
                    </Box>
                    <Group
                        mt="md"
                        position="center"
                    >
                        <Button
                            disabled={!fbHasUnprocessedFiles}
                            onClick={handleReprocessFailedFiles}
                        >
                            Re-process Failed
                        </Button>
                    </Group>
                </Box>
            )}
            <Divider my="lg" />
            <Box mt={2}>
                <Text
                    align="center"
                    mb={20}
                    size="xl"
                    weight={700}
                >
                    Import from DJ Software
                </Text>
                <Text
                    align="center"
                    mb={20}
                    size="md"
                >
                    This section allows you to export from your DJ software and import to subbox.
                    There are two components to this: importing the audio files and importing the
                    meta information (information like playlists, ratings etc) You can follow the
                    below steps to achieve this.
                </Text>
                <Radio.Group
                    name="DJSoftware"
                    value={importType}
                    onChange={setImportType}
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
                {importType === 'rekordbox' && (
                    <Box mt={20}>
                        <Text
                            align="center"
                            mb={10}
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
                                Export your RB collection (From rekordbox desktop app:
                                File-&gt;Library-&gt;Backup Library).
                            </List.Item>
                            <Image
                                alt="RekordBox Backup"
                                mb={20}
                                src={RBBackup}
                                style={{ cursor: 'pointer' }}
                                width={200}
                                onClick={() => handleImageClick(RBBackup)}
                            />
                            <List.Item mb={20}>
                                Make sure you select &apos;yes&apos; to backing up music files as
                                well. This will create a &apos;rekordbox_bak&apos; folder with the
                                music files in. It will also create a zip folder but this is not
                                needed.
                            </List.Item>
                            <List.Item mb={20}>
                                To decrease the time it takes to import your collection to subbox,
                                create a zip of the &apos;rekordbox_bak&apos; directory made in the
                                above step. Call it &apos;rekordbox_bak.zip&apos;.
                            </List.Item>
                            <List.Item mb={20}>
                                Backup your collection as xml (File -&gt; Export Collection in xml
                                format). Save it as &apos;rekordbox-backup.xml&apos;. This contains
                                all the playlist data needed to create your playlists in subbox.
                            </List.Item>
                            <List.Item>
                                Once the above has been completed in rekordbox, upload the resulting
                                xml and rekordbox_bak directory zip to subbox in the above box and
                                tick the &apos;Rekordbox import&apos; check box.
                            </List.Item>
                        </List>
                    </Box>
                )}
                {importType === 'serato' && (
                    <Box mt={20}>
                        <Text
                            align="center"
                            mb={10}
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
                                Locate your audio files in Serato and zip them in to a file called
                                audio_files.zip
                            </List.Item>
                            <List.Item mb={20}>
                                Zip up your subcrates folder (located ~/Music/_Serato_/SubCrates).
                                Call it subcrates.zip.
                            </List.Item>
                            <List.Item mb={20}>
                                Drag and drop in to the section above and select &apos;serato
                                import&apos; check box
                            </List.Item>
                        </List>
                    </Box>
                )}
            </Box>
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
            <Modal
                centered
                opened={isModalOpen}
                size="auto"
                onClose={() => setIsModalOpen(false)}
            >
                <Text>
                    Seems like you are attempting to upload a Rekordbox export. If so, please check
                    the Rekordbox import check box.
                </Text>
            </Modal>
            <Modal
                centered
                opened={isLimitExceededModalOpen}
                size="auto"
                onClose={() => setIsLimitExceededModalOpen(false)}
            >
                <Text>
                    You have exceeded the maximum library size. To apply for more storage, post a
                    message in the discord here:{' '}
                    <a
                        href="https://discord.gg/mqrRbex3hs"
                        rel="noopener noreferrer"
                        target="_blank"
                    >
                        https://discord.gg/mqrRbex3hs
                    </a>
                </Text>
            </Modal>
        </Box>
    );
};
