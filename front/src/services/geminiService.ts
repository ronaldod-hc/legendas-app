// Configuração do Backend
const BACKEND_URL = "https://api-legendas.housecricket.com.br/transcribe";

// SE o de cima não funcionar (der erro de conexão), comente a linha acima
// e descomente a linha abaixo para usar o Tailscale (Rede Privada):
// const BACKEND_URL = "http://100.113.175.96:3000/transcribe";

export const generateSubtitlesFromGemini = async (
	mediaFile: File,
	duration: number,
): Promise<any> => {
	const formData = new FormData();
	formData.append("video", mediaFile);

	try {
		console.log(`Iniciando upload para o Backend: ${BACKEND_URL}`);
		console.log(
			`Arquivo: ${mediaFile.name}, Tamanho: ${(mediaFile.size / 1024 / 1024).toFixed(2)} MB`,
		);

		// Faz a requisição para a SUA VPS (não para o Google direto)
		const response = await fetch(BACKEND_URL, {
			method: "POST",
			body: formData,
			// O fetch define o Content-Type multipart/form-data automaticamente
		});

		if (!response.ok) {
			const errorData = await response.json().catch(() => ({}));
			throw new Error(
				errorData.error ||
					`Erro do servidor (${response.status}): ${response.statusText}`,
			);
		}

		const data = await response.json();

		// O backend devolve um objeto: { raw: "[...json string...]" }
		if (!data.raw) {
			throw new Error(
				"O servidor não retornou os dados no formato esperado.",
			);
		}

		console.log("Resposta recebida do servidor. Processando JSON...");

		// Parse do JSON que veio do backend
		const subtitles = JSON.parse(data.raw);

		// Validação básica
		if (!Array.isArray(subtitles)) {
			throw new Error("A resposta não é um array de legendas válido.");
		}

		return subtitles;
	} catch (error: any) {
		console.error("Erro na transcrição:", error);

		if (error.message.includes("Failed to fetch")) {
			throw new Error(
				"Não foi possível conectar ao servidor. Verifique se o Backend está rodando na VPS e se a porta 3000 está liberada.",
			);
		}

		throw new Error(`Falha na transcrição: ${error.message}`);
	}
};
