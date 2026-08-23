export const SUPPORTED_IMAGE_TYPES = [
	"image/jpeg",
	"image/png",
	"image/webp",
	"image/gif",
] as const;
export type SupportedImageType = (typeof SUPPORTED_IMAGE_TYPES)[number];

export const MAX_IMAGE_SOURCE_BYTES = 12 * 1024 * 1024;
export const MAX_IMAGE_ENCODED_BYTES = 2 * 1024 * 1024;
export const MAX_IMAGE_DIMENSION = 1600;

export type ImagePreparationErrorCode =
	| "unsupported"
	| "too-large"
	| "decode"
	| "encode";

export class ImagePreparationError extends Error {
	constructor(public readonly code: ImagePreparationErrorCode) {
		super(code);
	}
}

export interface PreparedImage {
	data: string;
	mimeType: SupportedImageType;
	width: number;
	height: number;
	encodedBytes: number;
}

interface DecodedImage {
	source: CanvasImageSource;
	width: number;
	height: number;
	release: () => void;
}

function normalizedMimeType(type: string): string {
	const normalized = type.split(";")[0]?.trim().toLowerCase();
	return normalized === "image/jpg" ? "image/jpeg" : normalized;
}

function isSupportedImageType(value: string): value is SupportedImageType {
	return SUPPORTED_IMAGE_TYPES.some((type) => type === value);
}

async function decodeImage(file: File): Promise<DecodedImage> {
	if (typeof createImageBitmap === "function") {
		try {
			const bitmap = await createImageBitmap(file, {
				imageOrientation: "from-image",
			});
			return {
				source: bitmap,
				width: bitmap.width,
				height: bitmap.height,
				release: () => bitmap.close(),
			};
		} catch {
			// Fall through for browsers with partial createImageBitmap support.
		}
	}

	const url = URL.createObjectURL(file);
	try {
		const image = new Image();
		image.decoding = "async";
		image.src = url;
		await image.decode();
		return {
			source: image,
			width: image.naturalWidth,
			height: image.naturalHeight,
			release: () => URL.revokeObjectURL(url),
		};
	} catch {
		URL.revokeObjectURL(url);
		throw new ImagePreparationError("decode");
	}
}

function canvasBlob(
	source: CanvasImageSource,
	width: number,
	height: number,
	type: "image/webp" | "image/jpeg",
	quality: number,
): Promise<Blob | null> {
	const canvas = document.createElement("canvas");
	canvas.width = width;
	canvas.height = height;
	const context = canvas.getContext("2d");
	if (!context) return Promise.resolve(null);
	if (type === "image/jpeg") {
		context.fillStyle = "#ffffff";
		context.fillRect(0, 0, width, height);
	}
	context.drawImage(source, 0, 0, width, height);
	return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

function blobToBase64(blob: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onerror = () => reject(new ImagePreparationError("encode"));
		reader.onload = () => {
			const value = String(reader.result ?? "");
			const separator = value.indexOf(",");
			if (separator < 0) reject(new ImagePreparationError("encode"));
			else resolve(value.slice(separator + 1));
		};
		reader.readAsDataURL(blob);
	});
}

/** Resize and re-encode an upload so repeated multimodal turns stay mobile-friendly. */
export async function prepareImage(file: File): Promise<PreparedImage> {
	const mimeType = normalizedMimeType(file.type);
	if (!isSupportedImageType(mimeType)) {
		throw new ImagePreparationError("unsupported");
	}
	if (file.size > MAX_IMAGE_SOURCE_BYTES)
		throw new ImagePreparationError("too-large");

	const decoded = await decodeImage(file);
	try {
		if (!decoded.width || !decoded.height)
			throw new ImagePreparationError("decode");
		const initialScale = Math.min(
			1,
			MAX_IMAGE_DIMENSION / Math.max(decoded.width, decoded.height),
		);
		let width = Math.max(1, Math.round(decoded.width * initialScale));
		let height = Math.max(1, Math.round(decoded.height * initialScale));
		const qualities = [0.84, 0.74, 0.64, 0.54];

		for (let sizeAttempt = 0; sizeAttempt < 7; sizeAttempt++) {
			let smallest: {
				blob: Blob;
				mimeType: "image/webp" | "image/jpeg";
			} | null = null;
			for (const quality of qualities) {
				for (const outputType of ["image/webp", "image/jpeg"] as const) {
					const candidate = await canvasBlob(
						decoded.source,
						width,
						height,
						outputType,
						quality,
					);
					if (!candidate) continue;
					if (!smallest || candidate.size < smallest.blob.size) {
						smallest = { blob: candidate, mimeType: outputType };
					}
					const encodedBytes = Math.ceil(candidate.size / 3) * 4;
					if (encodedBytes <= MAX_IMAGE_ENCODED_BYTES) {
						const candidateType = normalizedMimeType(candidate.type);
						return {
							data: await blobToBase64(candidate),
							mimeType: isSupportedImageType(candidateType)
								? candidateType
								: outputType,
							width,
							height,
							encodedBytes,
						};
					}
				}
			}

			if (
				smallest &&
				Math.ceil(smallest.blob.size / 3) * 4 <= MAX_IMAGE_ENCODED_BYTES
			) {
				return {
					data: await blobToBase64(smallest.blob),
					mimeType: smallest.mimeType,
					width,
					height,
					encodedBytes: Math.ceil(smallest.blob.size / 3) * 4,
				};
			}
			width = Math.max(1, Math.round(width * 0.75));
			height = Math.max(1, Math.round(height * 0.75));
		}
		throw new ImagePreparationError("encode");
	} finally {
		decoded.release();
	}
}
