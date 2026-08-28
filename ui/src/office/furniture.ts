/**
 * Scene props for the spatial floor. Independent of OfficeSpritePack —
 * swap the employee atlas without replacing desks and cabinets.
 */
export const OFFICE_FURNITURE = {
  desk: '/office/furniture/desk.png',
  chair: '/office/furniture/chair.png',
  cabinet: '/office/furniture/cabinet.png',
  coffee: '/office/furniture/coffee.png',
  plant: '/office/furniture/plant.png',
  generated: {
    workstation: '/office/furniture/workstation-v1.png',
    cabinet: '/office/furniture/filing-cabinet-v1.png',
    terminal: '/office/furniture/terminal-kiosk-v1.png',
    plant: '/office/furniture/plant-v1.png',
    wallWindow: '/office/furniture/wall-window-v1.png',
    wallWindowNight: '/office/furniture/wall-window-night-v1.png',
    floorTile: '/office/furniture/floor-tile-v1.png',
    workspaceRug: '/office/furniture/workspace-rug-v1.png',
    coffeeStation: '/office/furniture/coffee-station-v1.png',
    serverRack: '/office/furniture/server-rack-v1.png',
    personnelBoard: '/office/furniture/personnel-board-v1.png',
    operationsBoard: '/office/furniture/operations-board-v1.png',
    workspaceSign: '/office/furniture/workspace-sign-v1.png',
  },
} as const

export const OFFICE_MIN_DESKS = 2

export const officePixelImg = {
  imageRendering: 'pixelated' as const,
}
