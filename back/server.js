import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { GoogleAIFileManager } from '@google/generative-ai/server';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Configuração básica
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

// Habilita CORS para seu Front (ajuste a URL depois se quiser segurança extra)
app.use(cors({
    origin: ['https://legendas.housecricket.com.br', 'http://localhost:5173']
}));

// Configura pasta temporária para upload
const upload = multer({ dest: 'uploads/' });

// Rota de Healthcheck (pro Coolify saber que tá vivo)
app.get('/', (req, res) => res.send('Backend de Transcrição Ativo 🚀'));

app.post('/transcribe', upload.single('video'), async (req, res) => {
    let tempFilePath = null;

    try {
        // 1. Validação
        if (!req.file) {
            return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
        }

        // A chave vem das variáveis de ambiente do Coolify
        const API_KEY = process.env.GEMINI_API_KEY;
        if (!API_KEY) {
            return res.status(500).json({ error: 'Servidor sem chave de API configurada.' });
        }

        tempFilePath = req.file.path;
        console.log(`[Start] Recebido: ${req.file.originalname} (${(req.file.size / 1024 / 1024).toFixed(2)} MB)`);

        // 2. Inicializa SDKs
        const fileManager = new GoogleAIFileManager(API_KEY);
        const genAI = new GoogleGenerativeAI(API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

        // 3. Upload para o Google (File API)
        // Isso suporta arquivos gigantes porque não manda no corpo da requisição JSON
        const uploadResponse = await fileManager.uploadFile(tempFilePath, {
            mimeType: req.file.mimetype || "video/mp4",
            displayName: req.file.originalname,
        });

        console.log(`[Google] Upload concluído. URI: ${uploadResponse.file.uri}`);

        // 4. Aguarda o processamento do vídeo pelo Google
        // O Google precisa de uns segundos para indexar o vídeo antes de aceitar perguntas
        let file = await fileManager.getFile(uploadResponse.file.name);
        let attempts = 0;

        while (file.state === "PROCESSING") {
            attempts++;
            console.log(`[Google] Processando vídeo... (Tentativa ${attempts})`);
            await new Promise((resolve) => setTimeout(resolve, 5000)); // Espera 5s
            file = await fileManager.getFile(uploadResponse.file.name);

            if (attempts > 60) throw new Error("Tempo limite de processamento do vídeo excedido.");
        }

        if (file.state === "FAILED") {
            throw new Error("O processamento do vídeo pelo Google falhou.");
        }

        console.log(`[Google] Vídeo pronto! Gerando legendas...`);

        // 5. Gera a Transcrição
        // O Prompt pede estritamente um JSON para facilitar o Front
        const result = await model.generateContent([
            {
                fileData: {
                    mimeType: uploadResponse.file.mimeType,
                    fileUri: uploadResponse.file.uri
                }
            },
            {
                text: `
        Atue como um gerador profissional de legendas (SRT).
        Tarefa: Transcreva TODO o áudio deste vídeo.
        
        Regras de Saída:
        1. Retorne APENAS um Array JSON válido. Sem markdown (\`\`\`), sem texto extra.
        2. Formato: [{"id": 1, "startTime": 0.0, "endTime": 2.5, "text": "Fala..."}]
        3. startTime e endTime em segundos (float).
        4. Detecte o idioma automaticamente.
      ` }
        ]);

        const responseText = result.response.text();

        // Limpeza de segurança (caso a IA mande markdown)
        const cleanJson = responseText.replace(/```json/g, "").replace(/```/g, "").trim();

        // 6. Limpeza (Deleta o vídeo do Google e do Servidor para não lotar espaço)
        try {
            await fileManager.deleteFile(uploadResponse.file.name);
            if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
        } catch (cleanupError) {
            console.warn("Erro ao limpar arquivos temporários:", cleanupError);
        }

        // 7. Resposta final
        res.json({ raw: cleanJson });

    } catch (error) {
        console.error("[Erro Fatal]", error);
        // Tenta limpar o arquivo local se der erro
        if (tempFilePath && fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);

        res.status(500).json({
            error: error.message || "Erro interno no servidor.",
            details: error.toString()
        });
    }
});

app.listen(port, () => {
    console.log(`Backend rodando na porta ${port}`);
});