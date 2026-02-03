import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
	plugins: [react()],
	optimizeDeps: {
		exclude: ["@ffmpeg/ffmpeg", "@ffmpeg/util"],
	},
	// Configuração para Desenvolvimento Local (npm run dev)
	server: {
		headers: {
			"Cross-Origin-Embedder-Policy": "require-corp",
			"Cross-Origin-Opener-Policy": "same-origin",
		},
	},
	// Configuração para Produção no Coolify (npm run preview)
	preview: {
		host: true, // Libera o acesso externo (0.0.0.0)
		port: 3000, // Garante a porta 3000
		allowedHosts: [
			// AQUI ESTÁ A CORREÇÃO DO BLOQUEIO
			"legendas.housecricket.com.br",
			"www.legendas.housecricket.com.br",
		],
		headers: {
			// IMPORTANTE: Repetir os headers aqui para o FFmpeg funcionar em produção
			"Cross-Origin-Embedder-Policy": "require-corp",
			"Cross-Origin-Opener-Policy": "same-origin",
		},
	},
});
