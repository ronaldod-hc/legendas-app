// Define a URL base:
// Em produção (Coolify), ele usará VITE_API_URL.
// Localmente, usará o localhost.
const BACKEND_URL =
	import.meta.env.VITE_API_URL || "http://localhost:3000/transcribe";

export const generateSubtitlesFromGemini = async (
	mediaFile: File,
	duration: number,
): Promise<any> => {
	const formData = new FormData();
	formData.append("video", mediaFile);

	try {
		console.log(`Enviando para: ${BACKEND_URL}`);

		const response = await fetch(BACKEND_URL, {
			method: "POST",
			body: formData,
		});

		if (!response.ok) {
			const errorData = await response.json().catch(() => ({}));
			throw new Error(
				errorData.error || `Erro do servidor: ${response.status}`,
			);
		}

		const data = await response.json();

		if (!data.raw) {
			throw new Error("Formato de resposta inválido do servidor.");
		}

		// O servidor já processou e limpou o JSON, mas mandou como string
		const subtitles = JSON.parse(data.raw);

		return subtitles;
	} catch (error: any) {
		console.error("Erro na transcrição:", error);
		throw new Error(error.message || "Falha ao conectar com o servidor.");
	}
};
