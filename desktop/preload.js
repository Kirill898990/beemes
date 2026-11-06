// Мост для страницы beemes: показать окно (нажали на уведомление или звонят, а окно свёрнуто в трей).
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("beemesDesktop", {
  show: () => ipcRenderer.send("beemes:show"),
});
