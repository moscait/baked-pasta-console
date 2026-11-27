/**
 * Basemap tiles for the Network Map (the same source as the upstream console's Geolocate map).
 * vite.config.ts adds MAP_TILE_ORIGIN to the production Content-Security-Policy `img-src`, so
 * changing the tile source here keeps the policy in step; a missing entry blanks the map.
 */
export const MAP_TILE_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}';

export const MAP_TILE_ORIGIN = new URL(MAP_TILE_URL).origin;
