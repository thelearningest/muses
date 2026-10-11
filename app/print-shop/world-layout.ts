import { ENTRANCE, GALLERIES, getMuseumColliders, MUSEUM_BOUNDS } from "../museum/architecture";

export const SHOP_BOUNDS = MUSEUM_BOUNDS;
export const SHOP_ENTRANCE = ENTRANCE;
const names = ["The café menu", "The opening notice", "The festival identity", "The headline board", "The final programme"];
export const STATIONS = GALLERIES.slice(0, 5).map((gallery, index) => ({
  name: names[index], position: [gallery.position[0], gallery.position[2]] as [number, number],
  standing: gallery.standing, rotation: gallery.rotation, yaw: gallery.yaw,
}));
export const SHOP_COLLIDERS = getMuseumColliders();
export function nearbyStation(x: number, z: number): number | null {
  let nearest: number | null = null; let distance = 3;
  STATIONS.forEach((station, index) => {
    const next = Math.hypot(x - station.standing[0], z - station.standing[1]);
    if (next < distance && x * Math.sign(station.position[0]) > 4.3) { nearest = index; distance = next; }
  });
  return nearest;
}
