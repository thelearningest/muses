import { describe, expect, it } from "vitest";
import { ENTRANCE, GALLERIES, MUSEUM_BOUNDS, getMuseumColliders } from "../app/museum/architecture";

describe("connected museum layout", () => {
  const colliders = getMuseumColliders();
  const radius = 0.28;
  const traversable = (x: number, z: number) => x > MUSEUM_BOUNDS.minX + radius && x < MUSEUM_BOUNDS.maxX - radius && z > MUSEUM_BOUNDS.minZ + radius && z < MUSEUM_BOUNDS.maxZ - radius && !colliders.some((wall) => x > wall.minX - radius && x < wall.maxX + radius && z > wall.minZ - radius && z < wall.maxZ + radius);

  it.each(GALLERIES)("allows a visitor to walk from the entrance into $name and back", (gallery) => {
    const route = [[ENTRANCE.x, ENTRANCE.z], [0, gallery.standing[1]], gallery.standing, [0, gallery.standing[1]], [ENTRANCE.x, ENTRANCE.z]];
    for (let index = 1; index < route.length; index++) {
      const start = route[index - 1];
      const end = route[index];
      const samples = Math.ceil(Math.hypot(end[0] - start[0], end[1] - start[1]) / 0.1);
      for (let step = 0; step <= samples; step++) {
        const fraction = step / samples;
        expect(traversable(start[0] + (end[0] - start[0]) * fraction, start[1] + (end[1] - start[1]) * fraction)).toBe(true);
      }
    }
  });

  it("keeps the visitor outside displays and walls, with a clear doorway", () => {
    for (const gallery of GALLERIES) {
      expect(traversable(gallery.position[0], gallery.position[2])).toBe(gallery.kind === "gate");
      const doorX = Math.sign(gallery.position[0]) * 4;
      expect(traversable(doorX, gallery.position[2])).toBe(true);
      expect(traversable(doorX, gallery.position[2] + 3)).toBe(false);
      // Standing points face the exhibit, using the camera's local -Z forward.
      const toObject = Math.sign(gallery.position[0] - gallery.standing[0]);
      expect(Math.sign(-Math.sin(gallery.yaw))).toBe(toObject);
    }
  });
});
