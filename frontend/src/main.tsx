import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

// No StrictMode: it runs effects twice in development, which would ask MetaMask to sign the QR twice.
createRoot(document.getElementById("root")!).render(<App />);
