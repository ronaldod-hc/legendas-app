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
const port = process.env.PORT || 3000;

// Habilita CORS
app.use(cors({
    origin: ['https://legendas.housecricket.com.br', 'http://localhost:5173', 'http://localhost:4173'],
    methods: ['GET', 'POST']
}));

// Configura pasta temporária
const upload = multer({ dest: 'uploads/' });

// --- FUNÇÃO AUXILIAR DO CÓDIGO ANTIGO ---
// Helper to split text ensuring max character count and distributing time
const splitLongSegments = (subtitles, maxChars = 80) => {
    const processed = [];
    let currentId = 1;

    for (const sub of subtitles) {
        if (!sub.text || sub.text.length <= maxChars) {
            processed.push({ ...sub, id: currentId++ });
            continue;
        }

        // Logic to split long text
        const words = sub.text.split(' ');
        const chunks = [];
        let currentChunk = '';

        for (const word of words) {
            if ((currentChunk + word).length + 1 > maxChars) {
                if (currentChunk.trim()) chunks.push(currentChunk.trim());
                currentChunk = word + ' ';
            } else {
                currentChunk += word + ' ';
            }
        }
        if (currentChunk.trim()) chunks.push(currentChunk.trim());

        // Distribute time proportionally
        const totalDuration = sub.endTime - sub.startTime;
        const totalLength = sub.text.replace(/\s/g, '').length;

        let segmentStartTime = sub.startTime;

        chunks.forEach((chunk, index) => {
            const chunkLength = chunk.replace(/\s/g, '').length;
            const ratio = totalLength > 0 ? chunkLength / totalLength : 1 / chunks.length;
            let segmentDuration = totalDuration * ratio;

            let segmentEndTime = segmentStartTime + segmentDuration;
            if (index === chunks.length - 1) {
                segmentEndTime = sub.endTime;
            }

            processed.push({
                id: currentId++,
                startTime: parseFloat(segmentStartTime.toFixed(3)),
                endTime: parseFloat(segmentEndTime.toFixed(3)),
                text: chunk
            });

            segmentStartTime = segmentEndTime;
        });
    }
    return processed;
};

// Rota de Healthcheck
app.get('/', (req, res) => res.send('Backend de Transcrição Ativo 🚀'));

app.post('/transcribe', upload.single('video'), async (req, res) => {
    let tempFilePath = null;

    try {
        if (!req.file) {
            return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
        }

        const API_KEY = process.env.GEMINI_API_KEY;
        if (!API_KEY) {
            return res.status(500).json({ error: 'Servidor sem chave de API configurada.' });
        }

        tempFilePath = req.file.path;
        console.log(`[Start] Recebido: ${req.file.originalname} (${(req.file.size / 1024 / 1024).toFixed(2)} MB)`);

        // Inicializa SDKs
        const fileManager = new GoogleAIFileManager(API_KEY);
        const genAI = new GoogleGenerativeAI(API_KEY);
        // Mantendo o modelo que funcionou para você
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

        // 1. Upload para o Google
        const uploadResponse = await fileManager.uploadFile(tempFilePath, {
            mimeType: req.file.mimetype || "video/mp4",
            displayName: req.file.originalname,
        });

        console.log(`[Google] Upload concluído. URI: ${uploadResponse.file.uri}`);

        // 2. Aguarda processamento
        let file = await fileManager.getFile(uploadResponse.file.name);
        let attempts = 0;

        while (file.state === "PROCESSING") {
            attempts++;
            if (attempts % 2 === 0) console.log(`[Google] Processando... (${attempts * 2}s)`);
            await new Promise((resolve) => setTimeout(resolve, 2000));
            file = await fileManager.getFile(uploadResponse.file.name);
            if (attempts > 120) throw new Error("Tempo limite de processamento excedido (4min).");
        }

        if (file.state === "FAILED") {
            throw new Error("O processamento do vídeo pelo Google falhou.");
        }

        console.log(`[Google] Vídeo pronto! Gerando legendas...`);

        // 3. Prompt Original Restaurado
        // Usamos JSON Schema no texto pois a SDK @google/generative-ai lida melhor assim que a @google/genai nova
        const prompt = `
            Transcreva com precisão a fala no arquivo de mídia fornecido.
            
            Regras CRÍTICAS de Saída:
            1. Retorne APENAS um Array JSON válido.
            2. NÃO use blocos de código markdown (\`\`\`). Retorne apenas o texto bruto do JSON.
            3. Cada objeto deve ter exatamente: "id", "startTime", "endTime", "text".
            4. Os valores de startTime e endTime devem ser números (float) em segundos.
            5. Os segmentos NÃO devem ter tempos sobrepostos.
            6. Mantenha o texto de cada segmento conciso para legendas.
            7. A transcrição deve ser precisa e sincronizada com o áudio da mídia.
        `;

        const result = await model.generateContent([
            {
                fileData: {
                    mimeType: uploadResponse.file.mimeType,
                    fileUri: uploadResponse.file.uri
                }
            },
            { text: prompt }
        ]);

        const responseText = result.response.text();

        // Limpeza de Markdown
        const cleanJson = responseText.replace(/```json/g, "").replace(/```/g, "").trim();

        // 4. Parse e Pós-processamento (A chave para não ter sobreposição)
        const parsedData = JSON.parse(cleanJson);

        if (!Array.isArray(parsedData)) {
            throw new Error("A IA não retornou um array JSON válido.");
        }

        // Aplica a função de split e ajuste de tempo
        const optimizedSubtitles = splitLongSegments(parsedData, 80);

        // 5. Limpeza de arquivos
        try {
            await fileManager.deleteFile(uploadResponse.file.name);
            if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
        } catch (e) { console.warn("Erro ao limpar:", e.message); }

        // Retorna o JSON processado e limpo dentro de { raw: ... } para manter compatibilidade com seu front
        // Mas como já é um objeto limpo, vamos mandar stringificado para o front fazer o parse como antes
        res.json({ raw: JSON.stringify(optimizedSubtitles) });

    } catch (error) {
        console.error("[Erro Fatal]", error);
        if (tempFilePath && fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
        res.status(500).json({ error: error.message || "Erro interno." });
    }
});

app.listen(port, () => {
    console.log(`Backend rodando na porta ${port}`);
});