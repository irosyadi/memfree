import * as React from 'react';
import { toast } from 'sonner';
import { getAuthToken } from '@/actions/token';
import { NEXT_PUBLIC_VECTOR_HOST } from '@/lib/client_env';
import { useImageCompression } from '@/hooks/use-image-compression';

export interface UploadedFile {
    name: string;
    url: string;
    type: string;
}

interface PresignedResponse {
    url: string;
    file: string;
}

class UploadError extends Error {
    constructor(
        message: string,
        public fileName: string,
    ) {
        super(message);
        this.name = 'UploadError';
    }
}

async function getPresignedUrl(filename: string): Promise<PresignedResponse> {
    const response = await fetch(`/api/pre-signed`, {
        method: 'POST',
        body: JSON.stringify({ filename }),
    });

    if (!response.ok) {
        throw new UploadError(`Failed to get presigned URL`, filename);
    }

    return response.json();
}

async function uploadFileToR2(presignedUrl: string, file: File): Promise<void> {
    const response = await fetch(presignedUrl, {
        method: 'PUT',
        headers: {
            'Content-Type': file.type,
        },
        body: file,
    });

    if (!response.ok) {
        throw new UploadError('Upload failed', file.name);
    }
}

async function uploadSingleFile(file: File): Promise<UploadedFile> {
    const presignedData = await getPresignedUrl(file.name);
    await uploadFileToR2(presignedData.url, file);
    return {
        name: file.name,
        url: `https://image.memfree.me/${presignedData.file}`,
        type: file.type,
    };
}

export function useUploadFile() {
    const [uploadedFiles, setUploadedFiles] = React.useState<UploadedFile[]>();
    const [isUploading, setIsUploading] = React.useState(false);
    const { compressImage, compressionError } = useImageCompression({});

    const indexLocalFile = async (files: File[]) => {
        const endpoint = `${NEXT_PUBLIC_VECTOR_HOST}/api/index/local-file`;
        setIsUploading(true);
        try {
            const token = await getAuthToken();
            const formData = new FormData();
            formData.append('file', files[0]);
            const res = await fetch(endpoint, {
                method: 'POST',
                body: formData,
                headers: {
                    Token: `${token.data}`,
                },
            });
            return await res.json();
        } catch (err) {
            console.error(err);
            toast.error(String(err));
            throw err;
        } finally {
            setIsUploading(false);
        }
    };

    async function onUpload(files: File[]) {
        setIsUploading(true);
        try {
            if (files[0].type.startsWith('image/')) {
                const results = await Promise.all(
                    files.map(async (file) => {
                        try {
                            let compressedFile = await compressImage(file);
                            if (compressionError) {
                                compressedFile = file;
                            }
                            return await uploadSingleFile(compressedFile);
                        } catch (error) {
                            console.error(`Error uploading ${file.name}:`, error);
                            toast.error(`Failed to upload ${file.name}`);
                            return null;
                        }
                    }),
                );
                const successfulUploads = results.filter((result): result is UploadedFile => result !== null);
                if (successfulUploads.length > 0) {
                    setUploadedFiles((prev) => (prev ? [...prev, ...successfulUploads] : successfulUploads));
                }
            } else {
                const res = await indexLocalFile(files);
                setUploadedFiles((prev) => (prev ? [...prev, ...res] : res));
            }
        } catch (err) {
            console.error(err);
            setUploadedFiles([]);
            toast.error('Something went wrong, please try again later.');
        } finally {
            setIsUploading(false);
        }
    }

    return {
        onUpload,
        setUploadedFiles,
        uploadedFiles,
        isUploading,
    };
}
