// Мост для страницы beemes: показать окно (нажали на уведомление или звонят, а окно свёрнуто в трей).
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("beemesDesktop", {
  show: () => ipcRenderer.send("beemes:show"),
  // Записать вход на диск сразу (после входа, регистрации, выхода).
  flush: () => ipcRenderer.send("beemes:flush"),
});
