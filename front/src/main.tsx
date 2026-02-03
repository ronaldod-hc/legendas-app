import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App"; // O VS Code deve achar o App.tsx que você moveu
import "./index.css"; // O CSS que vamos criar agora

ReactDOM.createRoot(document.getElementById("root")!).render(
	<React.StrictMode>
		<App />
	</React.StrictMode>,
);
