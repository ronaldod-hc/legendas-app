import React, {
	useState,
	useRef,
	useEffect,
	useCallback,
	useMemo,
} from "react";
import type { Subtitle, SubtitleStyle } from "./types";
import { formatTime, formatSrtTime, formatSsaTime } from "./utils/formatTime";
import { generateSubtitlesFromGemini } from "./services/geminiService";
import Timeline from "./components/Timeline";
import ColorPicker from "./components/ColorPicker";
import {
	PlayIcon,
	PauseIcon,
	PlusIcon,
	TrashIcon,
	DownloadIcon,
	CopyIcon,
	CheckIcon,
	DragHandleIcon,
	ZoomInIcon,
	ZoomOutIcon,
	AudioIcon,
} from "./components/icons";
// Import modern v0.12+ functions
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";

const App: React.FC = () => {
	const [mediaFile, setMediaFile] = useState<File | null>(null);
	const [mediaSrc, setMediaSrc] = useState<string | null>(null);
	const [fileType, setFileType] = useState<"video" | "audio" | null>(null);
	const [duration, setDuration] = useState(0);
	const [currentTime, setCurrentTime] = useState(0);
	const [isPlaying, setIsPlaying] = useState(false);
	const [subtitles, setSubtitles] = useState<Subtitle[]>([]);
	const [activeSubtitleId, setActiveSubtitleId] = useState<number | null>(
		null,
	);

	// FFmpeg State
	const [ffmpegLoaded, setFfmpegLoaded] = useState(false);
	const ffmpegRef = useRef<FFmpeg | null>(null);
	const messageRef = useRef<HTMLParagraphElement | null>(null);

	// Initial Style State (Outline default)
	const [subtitleStyle, setSubtitleStyle] = useState<SubtitleStyle>({
		color: "#FFFFFF",
		fontSize: 16,
		outlineColor: "#000000",
		outlineWidth: 2, // Default 2px
		positionY: 85,
	});

	const [isLoading, setIsLoading] = useState<{
		active: boolean;
		message: string;
	}>({ active: false, message: "" });
	const [isCopied, setIsCopied] = useState(false);
	const [zoomLevel, setZoomLevel] = useState(1); // 1 = 100% (Fit to screen)

	const [draggedId, setDraggedId] = useState<number | null>(null);
	const [dropTargetId, setDropTargetId] = useState<number | null>(null);
	const [isDraggingOver, setIsDraggingOver] = useState(false);

	// State to track video dimensions for accurate aspect ratio preview
	const [mediaDimensions, setMediaDimensions] = useState<{
		width: number;
		height: number;
	} | null>(null);

	const mediaRef = useRef<HTMLVideoElement & HTMLAudioElement>(null);
	const dragCounter = useRef(0);

	// Load FFmpeg (v0.12+ Logic)
	const load = async () => {
		// Evita carregar duas vezes
		if (ffmpegRef.current && ffmpegLoaded) return;

		setIsLoading({
			active: true,
			message: "Carregando motor de vídeo (v0.12+)...",
		});

		try {
			const ffmpeg = new FFmpeg();
			ffmpegRef.current = ffmpeg;

			ffmpeg.on("log", ({ message }) => {
				if (messageRef.current) messageRef.current.innerHTML = message;
				console.log(message);
			});

			const baseURL = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm";
			await ffmpeg.load({
				coreURL: await toBlobURL(
					`${baseURL}/ffmpeg-core.js`,
					"text/javascript",
				),
				wasmURL: await toBlobURL(
					`${baseURL}/ffmpeg-core.wasm`,
					"application/wasm",
				),
			});

			// Ensure /tmp directory exists for fonts
			try {
				await ffmpeg.createDir("/tmp");
			} catch (e) {
				// Directory might already exist
			}

			// --- CORREÇÃO IMPORTANTE AQUI ---
			// Carrega o arquivo arial.ttf da pasta /public (acessível como /arial.ttf)
			// Mas salva como Roboto-Regular.ttf porque o gerador ASS hardcoded espera essa fonte
			const fontURL = "/arial.ttf";
			const fontData = await fetchFile(fontURL);
			await ffmpeg.writeFile("/tmp/Roboto-Regular.ttf", fontData);

			setFfmpegLoaded(true);
		} catch (error) {
			console.error("FFmpeg load failed", error);
			alert(
				"Erro ao carregar o processador de vídeo. Verifique se seu navegador suporta SharedArrayBuffer.",
			);
		} finally {
			setIsLoading({ active: false, message: "" });
		}
	};

	useEffect(() => {
		load();
	}, []);

	const handleFileSelect = (file: File | undefined | null) => {
		if (!file) return;

		if (file.type.startsWith("video/")) {
			setFileType("video");
		} else if (file.type.startsWith("audio/")) {
			setFileType("audio");
		} else {
			alert("Selecione um arquivo de vídeo ou áudio válido.");
			return;
		}

		setMediaFile(file);
		const url = URL.createObjectURL(file);
		setMediaSrc(url);
		setSubtitles([]);
		setCurrentTime(0);
		setIsPlaying(false);
		setZoomLevel(1);
		setMediaDimensions(null);
	};

	const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		handleFileSelect(e.target.files?.[0]);
	};

	const handleLoadedMetadata = () => {
		if (mediaRef.current) {
			setDuration(mediaRef.current.duration);
			if (fileType === "video" && "videoWidth" in mediaRef.current) {
				setMediaDimensions({
					width: mediaRef.current.videoWidth,
					height: mediaRef.current.videoHeight,
				});
			}
		}
	};

	const handleTimeUpdate = () => {
		if (mediaRef.current) {
			setCurrentTime(mediaRef.current.currentTime);
		}
	};

	const handleFileDragEnter = (e: React.DragEvent) => {
		e.preventDefault();
		e.stopPropagation();
		dragCounter.current++;
		if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
			setIsDraggingOver(true);
		}
	};

	const handleFileDragLeave = (e: React.DragEvent) => {
		e.preventDefault();
		e.stopPropagation();
		dragCounter.current--;
		if (dragCounter.current === 0) {
			setIsDraggingOver(false);
		}
	};

	const handleFileDragOver = (e: React.DragEvent) => {
		e.preventDefault();
		e.stopPropagation();
	};

	const handleFileDrop = (e: React.DragEvent) => {
		e.preventDefault();
		e.stopPropagation();
		setIsDraggingOver(false);
		dragCounter.current = 0;
		handleFileSelect(e.dataTransfer.files?.[0]);
	};

	const handlePlayPause = useCallback(() => {
		if (mediaRef.current) {
			if (mediaRef.current.paused) {
				mediaRef.current.play();
			} else {
				mediaRef.current.pause();
			}
		}
	}, []);

	const handleTimelineTimeUpdate = (time: number) => {
		if (mediaRef.current) {
			mediaRef.current.currentTime = time;
			setCurrentTime(time);
		}
	};

	const handleSubtitleChange = (updatedSubtitle: Subtitle) => {
		setSubtitles((subs) =>
			subs.map((s) =>
				s.id === updatedSubtitle.id ? updatedSubtitle : s,
			),
		);
	};

	const handleZoomIn = () => {
		setZoomLevel((prev) => Math.min(prev + 1, 20)); // Max zoom 20x
	};

	const handleZoomOut = () => {
		setZoomLevel((prev) => Math.max(prev - 1, 1)); // Min zoom 1x (Fit to screen)
	};

	const downloadSrt = (subs: Subtitle[], fileName: string) => {
		if (subs.length === 0) return;
		const sortedSubs = [...subs].sort((a, b) => a.startTime - b.startTime);
		const srtContent = sortedSubs
			.map((sub, index) => {
				const startTime = formatSrtTime(sub.startTime);
				const endTime = formatSrtTime(sub.endTime);
				return `${index + 1}\n${startTime} --> ${endTime}\n${sub.text}`;
			})
			.join("\n\n");

		const blob = new Blob([srtContent], {
			type: "text/plain;charset=utf-8",
		});
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		const baseName = fileName
			? `${fileName.split(".").slice(0, -1).join(".") || "media"}`
			: "subtitles";
		a.download = `${baseName}.srt`;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		URL.revokeObjectURL(url);
	};

	const extractAudio = async (videoFile: File): Promise<File> => {
		const ffmpeg = ffmpegRef.current;
		if (!ffmpeg || !ffmpegLoaded) throw new Error("FFmpeg não carregado");

		const inputName =
			"input_video" +
			videoFile.name.substring(videoFile.name.lastIndexOf("."));

		// v0.12 API: await ffmpeg.writeFile
		await ffmpeg.writeFile(inputName, await fetchFile(videoFile));

		// v0.12 API: await ffmpeg.exec
		await ffmpeg.exec([
			"-i",
			inputName,
			"-vn",
			"-acodec",
			"libmp3lame",
			"-q:a",
			"2",
			"output_audio.mp3",
		]);

		// v0.12 API: await ffmpeg.readFile
		const data = await ffmpeg.readFile("output_audio.mp3");
		return new File([data], "audio.mp3", { type: "audio/mpeg" });
	};

	const handleGenerateSubtitles = useCallback(async () => {
		if (!mediaFile || duration <= 0) {
			return;
		}

		setIsLoading({
			active: true,
			message: `Extraindo áudio e transcrevendo...`,
		});

		try {
			let fileToTranscribe = mediaFile;

			// If it's a video, extract audio locally first to save bandwidth and upload time
			if (fileType === "video" && ffmpegLoaded) {
				try {
					fileToTranscribe = await extractAudio(mediaFile);
					console.log("Audio extracted successfully");
				} catch (e) {
					console.error(
						"Failed to extract audio locally, falling back to full file upload",
						e,
					);
				}
			}

			const generatedSubs = await generateSubtitlesFromGemini(
				fileToTranscribe,
				duration,
			);
			const validatedSubs = generatedSubs.map((sub: any) => ({
				...sub,
				startTime: Math.max(0, Math.min(sub.startTime, duration)),
				endTime: Math.max(
					sub.startTime,
					Math.min(sub.endTime, duration),
				),
			}));
			setSubtitles(validatedSubs);
		} catch (error: any) {
			setSubtitles([
				{
					id: 1,
					startTime: 0,
					endTime: duration,
					text: `A transcrição falhou: ${error.message}`,
				},
			]);
		} finally {
			setIsLoading({ active: false, message: "" });
		}
	}, [mediaFile, duration, fileType, ffmpegLoaded]);

	useEffect(() => {
		if (
			mediaFile &&
			duration > 0 &&
			subtitles.length === 0 &&
			!isLoading.active
		) {
			handleGenerateSubtitles();
		}
	}, [
		mediaFile,
		duration,
		subtitles.length,
		isLoading.active,
		handleGenerateSubtitles,
	]);

	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if (
				e.code === "Space" &&
				document.activeElement?.tagName !== "INPUT" &&
				document.activeElement?.tagName !== "TEXTAREA"
			) {
				e.preventDefault();
				handlePlayPause();
			}
		};

		window.addEventListener("keydown", handleKeyDown);
		return () => {
			window.removeEventListener("keydown", handleKeyDown);
		};
	}, [handlePlayPause]);

	const handleAddSubtitle = () => {
		const newId =
			subtitles.length > 0
				? Math.max(...subtitles.map((s) => s.id)) + 1
				: 1;

		const sortedSubs = [...subtitles].sort(
			(a, b) => a.startTime - b.startTime,
		);
		let insertIndex = sortedSubs.length;
		let newStartTime;

		if (activeSubtitleId !== null) {
			const activeIndex = sortedSubs.findIndex(
				(s) => s.id === activeSubtitleId,
			);
			if (activeIndex !== -1) {
				insertIndex = activeIndex + 1;
				newStartTime = sortedSubs[activeIndex].endTime + 0.01;
			} else {
				newStartTime = currentTime;
			}
		} else {
			const indexAtTime = sortedSubs.findIndex(
				(s) => s.startTime >= currentTime,
			);
			if (indexAtTime !== -1) {
				insertIndex = indexAtTime;
				newStartTime = currentTime;
			} else {
				newStartTime =
					sortedSubs.length > 0
						? sortedSubs[sortedSubs.length - 1].endTime + 0.01
						: 0;
			}
		}

		if (newStartTime >= duration) return;

		const newEndTime = Math.min(newStartTime + 3, duration);

		const newSubtitle: Subtitle = {
			id: newId,
			startTime: newStartTime,
			endTime: newEndTime,
			text: "Nova legenda",
		};

		let subsToUpdate = [...sortedSubs];
		subsToUpdate.splice(insertIndex, 0, newSubtitle);

		let lastEndTime = newEndTime;
		for (let i = insertIndex + 1; i < subsToUpdate.length; i++) {
			const currentSub = subsToUpdate[i];
			const subDuration = Math.max(
				0.1,
				currentSub.endTime - currentSub.startTime,
			);
			const newSubStartTime = lastEndTime + 0.01;

			if (currentSub.startTime < newSubStartTime) {
				const newSubEndTime = newSubStartTime + subDuration;
				subsToUpdate[i] = {
					...currentSub,
					startTime: newSubStartTime,
					endTime: Math.min(newSubEndTime, duration),
				};
			}
			lastEndTime = subsToUpdate[i].endTime;
		}

		setSubtitles(subsToUpdate);
		setActiveSubtitleId(newId);
	};

	const handleDeleteSubtitle = (idToDelete: number) => {
		setSubtitles((subs) => subs.filter((s) => s.id !== idToDelete));
		if (activeSubtitleId === idToDelete) {
			setActiveSubtitleId(null);
		}
	};

	// Helper to generate ASS content
	const generateAssContent = (videoW: number, videoH: number) => {
		const clientW =
			(mediaRef.current as HTMLVideoElement)?.clientWidth || videoW;
		const resolutionScale = videoW / clientW;

		const scaledFontSize = Math.round(
			subtitleStyle.fontSize * resolutionScale * 1.15,
		);
		const scaledOutline = Math.round(
			subtitleStyle.outlineWidth * resolutionScale,
		);

		// ASS colors are BGR in Hex: &H00BBGGRR
		const hexToAssColor = (hex: string) => {
			const c = hex.replace("#", "");
			return `&H00${c.substring(4, 6)}${c.substring(2, 4)}${c.substring(0, 2)}`;
		};

		const fontColor = hexToAssColor(subtitleStyle.color);
		const outlineColor = hexToAssColor(subtitleStyle.outlineColor);

		const adjustedPositionY = subtitleStyle.positionY;
		const posY = Math.round(videoH * (adjustedPositionY / 100));
		const posX = Math.round(videoW / 2);

		const marginL = Math.round(videoW * 0.05);
		const marginR = Math.round(videoW * 0.05);

		// Using Roboto Regular which we loaded into /tmp/Roboto-Regular.ttf
		// In v0.12, we created the dir /tmp and put the file there.

		const styleLine = `Style: Default,Roboto,${scaledFontSize},${fontColor},&H000000FF,${outlineColor},&H00000000,0,0,0,0,100,100,0,0,1,${scaledOutline},0,5,${marginL},${marginR},0,1`;

		const eventLines = subtitles
			.sort((a, b) => a.startTime - b.startTime)
			.map(
				(sub) =>
					`Dialogue: 0,${formatSsaTime(sub.startTime)},${formatSsaTime(sub.endTime)},Default,,0,0,0,,{\\pos(${posX},${posY})}${sub.text.replace(/\n/g, "\\N")}`,
			)
			.join("\n");

		return `[Script Info]
Title: Subtitles
ScriptType: v4.00+
WrapStyle: 0
ScaledBorderAndShadow: yes
PlayResX: ${videoW}
PlayResY: ${videoH}

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
${styleLine}

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${eventLines}
`;
	};

	const handleExport = async () => {
		if (!mediaFile || subtitles.length === 0) {
			alert("Selecione um vídeo e gere legendas antes de exportar.");
			return;
		}

		const ffmpeg = ffmpegRef.current;
		if (!ffmpegLoaded || !ffmpeg) {
			alert("O processador de vídeo não está pronto.");
			return;
		}

		const videoElement = mediaRef.current as HTMLVideoElement;
		if (!videoElement || videoElement.videoWidth === 0) {
			alert(
				"Metadados de vídeo não carregados. Por favor, espere um momento e tente novamente.",
			);
			return;
		}

		setIsLoading({
			active: true,
			message: "Processando vídeo no navegador (isso pode demorar)...",
		});

		try {
			const inputName = "input.mp4";
			const outputName = "output.mp4";
			const subName = "subtitles.ass";

			// 1. Write Video
			// v0.12 API: await ffmpeg.writeFile
			await ffmpeg.writeFile(inputName, await fetchFile(mediaFile));

			// 2. Generate and Write Subtitles
			const assContent = generateAssContent(
				videoElement.videoWidth,
				videoElement.videoHeight,
			);
			await ffmpeg.writeFile(subName, assContent);

			console.log("Starting ffmpeg processing...");

			// 3. Run FFmpeg command (v0.12 API: await ffmpeg.exec)
			await ffmpeg.exec([
				"-i",
				inputName,
				"-vf",
				`subtitles=${subName}:fontsdir=/tmp`,
				"-c:a",
				"copy",
				"-preset",
				"ultrafast",
				outputName,
			]);

			console.log("FFmpeg processing complete.");

			// 4. Read result (v0.12 API: await ffmpeg.readFile)
			const data = await ffmpeg.readFile(outputName);

			// 5. Download
			// Data from readFile is string | Uint8Array, for binary it's Uint8Array
			const blob = new Blob([data], { type: "video/mp4" });
			const url = URL.createObjectURL(blob);
			const a = document.createElement("a");
			a.href = url;
			a.download = `subtitled_${mediaFile.name}`;
			document.body.appendChild(a);
			a.click();
			document.body.removeChild(a);
			URL.revokeObjectURL(url);
		} catch (error) {
			console.error(error);
			const errorMessage =
				error instanceof Error ? error.message : "Erro ao exportar.";
			alert(`Erro: ${errorMessage}. Verifique o console para detalhes.`);
		} finally {
			setIsLoading({ active: false, message: "" });
		}
	};

	const handleCopyTranscription = () => {
		if (subtitles.length === 0) return;
		navigator.clipboard.writeText(fullTranscription);
		setIsCopied(true);
		setTimeout(() => {
			setIsCopied(false);
		}, 2000);
	};

	const handleDownloadSrt = () => {
		if (subtitles.length === 0 || !mediaFile) return;
		downloadSrt(subtitles, mediaFile.name);
	};

	// Drag and drop handlers
	const handleDragStart = (e: React.DragEvent, id: number) => {
		e.dataTransfer.setData("text/plain", id.toString());
		setDraggedId(id);
	};
	const handleDragOver = (e: React.DragEvent) => e.preventDefault();
	const handleDragEnter = (id: number) => {
		if (id !== draggedId) setDropTargetId(id);
	};
	const handleDragEnd = () => {
		setDraggedId(null);
		setDropTargetId(null);
	};
	const handleDrop = (e: React.DragEvent, dropOnTargetId: number) => {
		e.preventDefault();
		const draggedId = parseInt(e.dataTransfer.getData("text/plain"), 10);
		setDraggedId(null);
		setDropTargetId(null);
		if (!draggedId || draggedId === dropOnTargetId) return;

		setSubtitles((currentSubs) => {
			const sortedSubs = [...currentSubs].sort(
				(a, b) => a.startTime - b.startTime,
			);
			const draggedItemIndex = sortedSubs.findIndex(
				(s) => s.id === draggedId,
			);
			const dropTargetIndex = sortedSubs.findIndex(
				(s) => s.id === dropOnTargetId,
			);
			if (draggedItemIndex === -1 || dropTargetIndex === -1)
				return currentSubs;

			const subsWithDuration = sortedSubs.map((s) => ({
				...s,
				duration: s.endTime - s.startTime,
			}));
			const [draggedItem] = subsWithDuration.splice(draggedItemIndex, 1);
			subsWithDuration.splice(dropTargetIndex, 0, draggedItem);

			let lastEndTime = 0;
			return subsWithDuration.map((sub, index) => {
				const newStartTime = index === 0 ? 0 : lastEndTime + 0.01;
				const newEndTime = Math.min(
					newStartTime + Math.max(0.1, sub.duration),
					duration,
				);
				lastEndTime = newEndTime;
				const { duration: _, ...rest } = sub;
				return {
					...rest,
					startTime: newStartTime,
					endTime: newEndTime,
				};
			});
		});
	};

	const fullTranscription = useMemo(
		() => subtitles.map((s) => s.text).join(" "),
		[subtitles],
	);
	const currentSubtitleText =
		subtitles.find(
			(s) => currentTime >= s.startTime && currentTime <= s.endTime,
		)?.text || "";
	const sortedSubtitles = useMemo(
		() => [...subtitles].sort((a, b) => a.startTime - b.startTime),
		[subtitles],
	);

	return (
		<div className="min-h-screen bg-brand-dark flex flex-col font-sans relative">
			{isLoading.active && (
				<div className="absolute inset-0 bg-black/70 flex flex-col items-center justify-center z-50">
					<div className="w-16 h-16 border-4 border-brand-accent border-t-transparent rounded-full animate-spin"></div>
					<p className="mt-4 text-xl text-brand-light">
						{isLoading.message}
					</p>
					<p
						className="mt-2 text-sm text-brand-gray-300 px-4 text-center max-w-md"
						ref={messageRef}></p>
				</div>
			)}

			<header className="flex items-center justify-between p-4 bg-brand-gray-800 shadow-md">
				<h1 className="text-2xl font-bold text-brand-light">
					Editor de Legendas de Mídia
				</h1>
				<div className="flex items-center gap-4">
					{!mediaSrc && (
						<label className="bg-brand-accent text-black px-4 py-2 rounded-md font-semibold hover:bg-yellow-300 cursor-pointer">
							Selecionar Mídia
							<input
								type="file"
								accept="video/*,audio/*"
								className="hidden"
								onChange={handleFileChange}
							/>
						</label>
					)}
					{mediaSrc && (
						<>
							<button
								onClick={handleCopyTranscription}
								className={`px-4 py-2 rounded-md font-semibold flex items-center gap-2 transition-colors duration-200 ${isCopied ? "bg-green-500 text-white" : "bg-brand-accent text-black hover:bg-yellow-300"} disabled:opacity-50 disabled:cursor-not-allowed`}
								disabled={subtitles.length === 0 || isCopied}>
								{isCopied ? (
									<>
										<CheckIcon className="w-5 h-5" />{" "}
										Copiado!
									</>
								) : (
									<>
										<CopyIcon className="w-5 h-5" /> Copiar
										Transcrição
									</>
								)}
							</button>
							<button
								onClick={handleDownloadSrt}
								className="bg-brand-accent text-black px-4 py-2 rounded-md font-semibold hover:bg-yellow-300 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
								disabled={subtitles.length === 0}
								title="Baixar arquivo .srt">
								<DownloadIcon className="w-5 h-5" />
								SRT
							</button>
							{fileType === "video" && (
								<>
									<button
										onClick={handleExport}
										className="bg-black text-white px-4 py-2 rounded-md font-semibold hover:bg-gray-700 flex items-center gap-2 border border-brand-gray-600">
										<DownloadIcon className="w-5 h-5" />
										Exportar MP4
									</button>
								</>
							)}
						</>
					)}
				</div>
			</header>

			{mediaSrc ? (
				<main className="flex-grow flex flex-col overflow-hidden">
					{fileType === "video" ? (
						<>
							{/* Main Layout - 3 Columns: 48% | 4% | 48% */}
							<div className="flex-grow flex w-full h-[calc(100vh-260px)]">
								{/* Left Column (48%): Video Preview */}
								<div className="w-[48%] p-4 flex flex-col items-center justify-center bg-black border-r border-brand-gray-700">
									<div
										className="relative flex items-center justify-center"
										style={{
											aspectRatio: mediaDimensions
												? `${mediaDimensions.width} / ${mediaDimensions.height}`
												: "auto",
											maxHeight: "100%",
											maxWidth: "100%",
										}}>
										<video
											ref={mediaRef}
											src={mediaSrc}
											className="w-full h-full object-contain"
											onLoadedMetadata={
												handleLoadedMetadata
											}
											onTimeUpdate={handleTimeUpdate}
											onPlay={() => setIsPlaying(true)}
											onPause={() => setIsPlaying(false)}
											onClick={handlePlayPause}></video>
										{currentSubtitleText && (
											<div
												className="absolute pointer-events-none font-sans flex justify-center w-full"
												style={{
													top: `${subtitleStyle.positionY}%`,
													transform:
														"translateY(-50%)",
													left: 0,
												}}>
												<div className="flex justify-center w-full">
													<div
														style={{
															fontFamily:
																"Arial, sans-serif", // Fallback font for preview
															color: subtitleStyle.color,
															fontSize: `${subtitleStyle.fontSize * 1.15}px`,
															WebkitTextStroke: `${subtitleStyle.outlineWidth * 2}px ${subtitleStyle.outlineColor}`,
															paintOrder:
																"stroke fill",
															lineHeight: 1.2,
															fontWeight:
																"normal",
															textAlign: "center",
															whiteSpace:
																"pre-wrap",
															maxWidth: "90%",
															textWrap: "balance",
														}}>
														{currentSubtitleText}
													</div>
												</div>
											</div>
										)}
									</div>
									<div className="flex items-center gap-4 mt-4 text-white">
										<button
											onClick={handlePlayPause}
											className="p-2 bg-brand-gray-700 rounded-full hover:bg-brand-gray-600">
											{isPlaying ? (
												<PauseIcon className="w-6 h-6" />
											) : (
												<PlayIcon className="w-6 h-6" />
											)}
										</button>
										<span className="font-mono">
											{formatTime(currentTime)} /{" "}
											{formatTime(duration)}
										</span>
									</div>
								</div>

								{/* Middle Column (4%): Vertical Y Position Slider */}
								<div className="w-[4%] bg-brand-gray-900 flex items-center justify-center border-r border-brand-gray-700">
									<div className="relative w-full h-full flex items-center justify-center">
										<input
											type="range"
											min="0"
											max="100"
											value={subtitleStyle.positionY}
											onChange={(e) =>
												setSubtitleStyle((s) => ({
													...s,
													positionY:
														parseInt(
															e.target.value,
															10,
														) || 80,
												}))
											}
											className="absolute w-64 h-2 bg-brand-gray-600 rounded-lg appearance-none cursor-pointer accent-brand-accent"
											style={{
												transform: "rotate(90deg)",
											}}
											title={`Posição Y: ${subtitleStyle.positionY}%`}
										/>
									</div>
								</div>

								{/* Right Column (48%): Subtitle Editor */}
								<div className="w-[48%] p-4 flex flex-col bg-brand-gray-800">
									<div className="flex-shrink-0">
										<h3 className="text-lg font-semibold text-brand-light mb-4">
											Estilo da Legenda
										</h3>
										<div className="space-y-4 text-sm">
											<div className="flex items-center gap-4">
												<div className="flex flex-col flex-1">
													<label className="block mb-1 text-brand-gray-300">
														Tamanho
													</label>
													<input
														type="range"
														min="10"
														max="30"
														value={
															subtitleStyle.fontSize
														}
														onChange={(e) =>
															setSubtitleStyle(
																(s) => ({
																	...s,
																	fontSize:
																		parseInt(
																			e
																				.target
																				.value,
																			10,
																		),
																}),
															)
														}
														className="w-full accent-brand-accent"
													/>
												</div>

												<ColorPicker
													label="Texto"
													color={subtitleStyle.color}
													setColor={(newColor) =>
														setSubtitleStyle(
															(s) => ({
																...s,
																color: newColor,
															}),
														)
													}
												/>

												<ColorPicker
													label="Contorno"
													color={
														subtitleStyle.outlineColor
													}
													setColor={(newColor) =>
														setSubtitleStyle(
															(s) => ({
																...s,
																outlineColor:
																	newColor,
															}),
														)
													}
												/>

												<div className="flex flex-col flex-1">
													<label className="block mb-1 text-brand-gray-300">
														Contorno
													</label>
													<input
														type="range"
														min="0"
														max="5"
														value={
															subtitleStyle.outlineWidth
														}
														onChange={(e) =>
															setSubtitleStyle(
																(s) => ({
																	...s,
																	outlineWidth:
																		parseInt(
																			e
																				.target
																				.value,
																			10,
																		),
																}),
															)
														}
														className="w-full accent-brand-accent"
													/>
												</div>
											</div>
										</div>
									</div>

									<div className="flex-1 flex flex-col min-h-0 mt-4">
										<div className="flex justify-between items-center mb-2">
											<h3 className="text-lg font-semibold text-brand-light">
												Segmentos da Legenda
											</h3>
											<button
												onClick={handleAddSubtitle}
												className="bg-brand-gray-700 text-sm text-white px-3 py-1 rounded-md font-semibold hover:bg-brand-gray-600 flex items-center gap-1">
												<PlusIcon className="w-4 h-4" />{" "}
												Adicionar
											</button>
										</div>
										<div className="flex-grow space-y-1 overflow-y-auto pr-2 custom-scrollbar">
											{sortedSubtitles.map((sub) => (
												<div
													key={sub.id}
													onDrop={(e) =>
														handleDrop(e, sub.id)
													}
													onDragOver={handleDragOver}
													onDragEnter={() =>
														handleDragEnter(sub.id)
													}
													className={`group relative flex items-center gap-1 rounded-md transition-colors py-1 ${sub.id === activeSubtitleId ? "bg-brand-accent/20" : ""} ${draggedId === sub.id ? "opacity-30" : "opacity-100"}`}>
													{dropTargetId === sub.id &&
														draggedId !==
															sub.id && (
															<div className="absolute top-0 left-0 right-0 h-0.5 bg-brand-accent rounded-full -mt-0.5" />
														)}
													<div
														draggable="true"
														onDragStart={(e) =>
															handleDragStart(
																e,
																sub.id,
															)
														}
														onDragEnd={
															handleDragEnd
														}
														className="p-2 cursor-grab text-brand-gray-300 hover:text-brand-light">
														<DragHandleIcon className="w-5 h-5" />
													</div>
													<textarea
														value={sub.text}
														onChange={(e) =>
															handleSubtitleChange(
																{
																	...sub,
																	text: e
																		.target
																		.value,
																},
															)
														}
														onFocus={() => {
															setActiveSubtitleId(
																sub.id,
															);
															if (
																mediaRef.current
															)
																mediaRef.current.currentTime =
																	sub.startTime;
														}}
														className="flex-grow w-full bg-transparent text-brand-light p-2 rounded-md resize-none border-none focus:bg-brand-gray-700 focus:outline-none focus:ring-2 focus:ring-brand-accent"
														rows={2}
													/>
													<button
														onClick={() =>
															handleDeleteSubtitle(
																sub.id,
															)
														}
														className="p-2 text-brand-gray-300 hover:text-red-500 transition-opacity opacity-0 group-hover:opacity-100 focus:opacity-100">
														<TrashIcon className="w-5 h-5" />
													</button>
												</div>
											))}
										</div>
									</div>
								</div>
							</div>
						</>
					) : (
						<div className="flex-grow flex w-full h-[calc(100vh-260px)]">
							{/* Left Column: Audio Player & Info */}
							<div className="w-[40%] p-4 flex flex-col items-center justify-center bg-black border-r border-brand-gray-700">
								<AudioIcon className="w-24 h-24 text-brand-gray-600 mb-6" />
								<p className="text-center text-brand-light mb-6 break-all px-4 font-semibold">
									{mediaFile?.name}
								</p>
								<audio
									ref={mediaRef}
									src={mediaSrc}
									controls
									className="w-full max-w-sm"
									onLoadedMetadata={handleLoadedMetadata}
									onTimeUpdate={handleTimeUpdate}
									onPlay={() => setIsPlaying(true)}
									onPause={() => setIsPlaying(false)}
								/>
								<div className="flex items-center gap-4 mt-4 text-white">
									<span className="font-mono">
										{formatTime(currentTime)} /{" "}
										{formatTime(duration)}
									</span>
								</div>
							</div>
							{/* Right Column: Subtitle Editor */}
							<div className="w-[60%] p-4 flex flex-col bg-brand-gray-800">
								<div className="flex-1 flex flex-col min-h-0">
									<div className="flex justify-between items-center mb-2">
										<h3 className="text-lg font-semibold text-brand-light">
											Segmentos da Transcrição
										</h3>
										<button
											onClick={handleAddSubtitle}
											className="bg-brand-gray-700 text-sm text-white px-3 py-1 rounded-md font-semibold hover:bg-brand-gray-600 flex items-center gap-1">
											<PlusIcon className="w-4 h-4" />{" "}
											Adicionar
										</button>
									</div>
									<div className="flex-grow space-y-1 overflow-y-auto pr-2 custom-scrollbar">
										{sortedSubtitles.map((sub) => (
											<div
												key={sub.id}
												onDrop={(e) =>
													handleDrop(e, sub.id)
												}
												onDragOver={handleDragOver}
												onDragEnter={() =>
													handleDragEnter(sub.id)
												}
												className={`group relative flex items-center gap-1 rounded-md transition-colors py-1 ${sub.id === activeSubtitleId ? "bg-brand-accent/20" : ""} ${draggedId === sub.id ? "opacity-30" : "opacity-100"}`}>
												{dropTargetId === sub.id &&
													draggedId !== sub.id && (
														<div className="absolute top-0 left-0 right-0 h-0.5 bg-brand-accent rounded-full -mt-0.5" />
													)}
												<div
													draggable="true"
													onDragStart={(e) =>
														handleDragStart(
															e,
															sub.id,
														)
													}
													onDragEnd={handleDragEnd}
													className="p-2 cursor-grab text-brand-gray-300 hover:text-brand-light">
													<DragHandleIcon className="w-5 h-5" />
												</div>
												<textarea
													value={sub.text}
													onChange={(e) =>
														handleSubtitleChange({
															...sub,
															text: e.target
																.value,
														})
													}
													onFocus={() => {
														setActiveSubtitleId(
															sub.id,
														);
														if (mediaRef.current)
															mediaRef.current.currentTime =
																sub.startTime;
													}}
													className="flex-grow w-full bg-transparent text-brand-light p-2 rounded-md resize-none border-none focus:bg-brand-gray-700 focus:outline-none focus:ring-2 focus:ring-brand-accent"
													rows={2}
												/>
												<button
													onClick={() =>
														handleDeleteSubtitle(
															sub.id,
														)
													}
													className="p-2 text-brand-gray-300 hover:text-red-500 transition-opacity opacity-0 group-hover:opacity-100 focus:opacity-100">
													<TrashIcon className="w-5 h-5" />
												</button>
											</div>
										))}
									</div>
								</div>
							</div>
						</div>
					)}

					{/* Timeline Controls Bar */}
					<div className="h-10 bg-brand-gray-800 flex items-center justify-end px-4 border-t border-brand-gray-700 gap-4">
						<div className="flex items-center gap-2">
							<span className="text-xs text-brand-gray-300">
								Zoom: {zoomLevel}x
							</span>
							<button
								onClick={handleZoomOut}
								className="p-1 rounded hover:bg-brand-gray-700 text-brand-light disabled:opacity-50"
								disabled={zoomLevel <= 1}>
								<ZoomOutIcon className="w-4 h-4" />
							</button>
							<input
								type="range"
								min="1"
								max="20"
								value={zoomLevel}
								onChange={(e) =>
									setZoomLevel(parseInt(e.target.value))
								}
								className="w-24 h-1 bg-brand-gray-600 rounded-lg appearance-none cursor-pointer accent-brand-accent"
							/>
							<button
								onClick={handleZoomIn}
								className="p-1 rounded hover:bg-brand-gray-700 text-brand-light disabled:opacity-50"
								disabled={zoomLevel >= 20}>
								<ZoomInIcon className="w-4 h-4" />
							</button>
						</div>
					</div>

					<Timeline
						duration={duration}
						currentTime={currentTime}
						subtitles={subtitles}
						activeSubtitleId={activeSubtitleId}
						zoomLevel={zoomLevel}
						onTimeUpdate={handleTimelineTimeUpdate}
						onSubtitleChange={handleSubtitleChange}
						onSubtitleSelect={setActiveSubtitleId}
					/>
				</main>
			) : (
				<div
					className={`flex-grow flex flex-col items-center justify-center m-8 border-4 border-dashed rounded-3xl transition-colors duration-300 ${isDraggingOver ? "border-brand-accent bg-brand-gray-800" : "border-brand-gray-700"}`}
					onDragEnter={handleFileDragEnter}
					onDragOver={handleFileDragOver}
					onDragLeave={handleFileDragLeave}
					onDrop={handleFileDrop}>
					<h2 className="text-3xl font-bold mb-4">
						Arraste e solte um arquivo de vídeo ou áudio aqui
					</h2>
					<p className="text-brand-gray-300 mb-8">ou</p>
					<label className="bg-brand-accent text-black px-6 py-3 rounded-lg font-semibold text-lg hover:bg-yellow-300 cursor-pointer shadow-lg">
						Selecionar Arquivo de Mídia
						<input
							type="file"
							accept="video/*,audio/*"
							className="hidden"
							onChange={handleFileChange}
						/>
					</label>
				</div>
			)}
		</div>
	);
};

export default App;
