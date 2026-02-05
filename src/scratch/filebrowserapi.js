import fs from 'fs';
import https from 'https';
import axios from 'axios';

// Function to get the access token from the FileBrowser server
async function getToken() {
    console.log('Requesting access token...');

    try {
        const response = await axios.post('http://localhost:8081/api/login', {
            // CHANGE THIS IN THE FRONTEND
            password: 'test080425',
            username: 'test080425', // CHANGE THIS IN THE FRONTEND
        });
        console.log('Access token received.');
        return response.data;
    } catch (error) {
        console.error('Error while requesting access token:', error);
        return null;
    }
}

// Function to upload a text file to the FileBrowser server
async function uploadFile(token) {
    console.log('Uploading file...');

    // Read the file into a string
    const fileContents = fs.readFileSync('src/scratch/test.txt', 'utf8');

    try {
        // Send a POST request to the FileBrowser server
        const res = await axios.post(
            'http://localhost:8081/api/resources/downloads/test.txt?override=false',
            fileContents,
            {
                headers: {
                    'Content-Type': 'text/plain', // ADJUST THIS PER FILETYPE (img, pdf, etc)
                    'X-Auth': `${token}`, // WHY NOT USE AUTH HEADER?!
                },
            },
        );

        console.log(res);
        console.log('File uploaded successfully:', res.data);
    } catch (error) {
        console.error('Error while uploading file:', error);
    }
}

// Function to download a text file from the FileBrowser server
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function downloadFile(token) {
    console.log('Downloading file...');

    const url = 'https://browser.docker.localhost/browser/api/raw/downloads/subbox_rb_export.xml'; // WHY USE DIFFERENT ENDPOINTS TO UPLOAD AND DOWNLOAD? (resources vs raw)
    // const url = 'http://localhost:8081/api/raw/downloads/test.txt'; // WHY USE DIFFERENT ENDPOINTS TO UPLOAD AND DOWNLOAD? (resources vs raw)

    try {
        const response = await axios.get(url, {
            headers: {
                'X-Auth': `${token}`,
            },
            // todo remove this in prod. This is only needed for dev testing
            httpsAgent: new https.Agent({
                rejectUnauthorized: false,
            }),

            responseType: 'stream',
        });

        // const response = await axios({
        //    headers: {
        //        'X-Auth': `${token}`,
        //    },
        //    method: 'GET',
        //    responseType: 'stream',
        //    url,
        //    // todo remove this in prod. This is only needed for dev testing
        //    httpsAgent: new https.Agent({
        //      rejectUnauthorized: false
        //    }),
        // });

        const writer = fs.createWriteStream('subbox_rb_export.xml');

        response.data.pipe(writer);

        return new Promise((resolve, reject) => {
            writer.on('finish', () => {
                console.log('File downloaded successfully.');
                resolve();
            });
            writer.on('error', (error) => {
                console.error('Error while downloading file:', error);
                reject(error);
            });
        });
    } catch (error) {
        console.error('Error while requesting file download:', error);
        return null;
    }
}

// Function to download a text file from the FileBrowser server
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function listFiles(token) {
    console.log('list files...');

    // const url = 'https://browser.docker.localhost/browser/api/resources/uploads/foo/foo - bar/00 - Departed (Original Mix).mp3';
    const url =
        'https://browser.docker.localhost/browser/api/resources/uploads/bar/foo - bar/00 - Departed (Original Mix).mp3';

    try {
        const response = await axios.get(url, {
            headers: {
                'X-Auth': `${token}`,
            },
            // todo remove this in prod. This is only needed for dev testing
            httpsAgent: new https.Agent({
                rejectUnauthorized: false,
            }),
        });
        console.log('get resp');
        console.log(response.data);
    } catch (error) {
        console.error('Error while requesting file download:', error);
    }
}

// Main function to control the flow of the program
async function main() {
    const token = await getToken();

    if (token) {
        await uploadFile(token);
    } else {
        console.log('No access token received. Aborting.');
    }
}

// Catch any unhandled Promise rejections
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Start the program
main();
