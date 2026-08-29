/**
 * Scene props for the spatial floor. Independent of OfficeSpritePack —
 * swap the employee atlas without replacing desks and cabinets.
 */
export const OFFICE_FURNITURE = {
  generated: {
    workstation: '/office/furniture/workstation-v2.png',
    vacantWorkstation: '/office/furniture/vacant-workstation-v2.png',
    cabinet: '/office/furniture/filing-cabinet-v2.png',
    emptyCabinet: '/office/furniture/empty-cabinet-v1.png',
    terminal: '/office/furniture/terminal-kiosk-v2.png',
    plant: '/office/furniture/plant-v2.png',
    wallWindow: '/office/furniture/wall-window-v2.png',
    wallWindowNight: '/office/furniture/wall-window-night-v2.png',
    floorTile: '/office/furniture/floor-tile-v2.png',
    workspaceRug: '/office/furniture/workspace-rug-v2.png',
    coffeeStation: '/office/furniture/coffee-station-v2.png',
    serverRack: '/office/furniture/server-rack-v2.png',
    personnelBoard: '/office/furniture/personnel-board-v2.png',
    operationsBoard: '/office/furniture/operations-board-v2.png',
    workspaceSign: '/office/furniture/workspace-sign-v2.png',
    spawnCompass: '/office/furniture/spawn-compass-v2.png',
    routeChevron: '/office/furniture/route-chevron-v1.png',
    collisionImpact: '/office/furniture/collision-impact-v1.png',
    mailService: '/office/furniture/mail-service-v1.png',
    archiveService: '/office/furniture/archive-service-v1.png',
  },
} as const

export const OFFICE_MIN_DESKS = 2

export const officePixelImg = {
  imageRendering: 'pixelated' as const,
}
