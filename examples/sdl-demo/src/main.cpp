#include <SDL.h>

#include <algorithm>
#include <cmath>

#include <emscripten/emscripten.h>

namespace {
SDL_Window* window = nullptr;
SDL_Renderer* renderer = nullptr;
float position = 0.0f;
int direction = 1;

void frame() {
  SDL_Event event;
  while (SDL_PollEvent(&event)) {
    if (event.type == SDL_QUIT) {
      emscripten_cancel_main_loop();
    } else if (event.type == SDL_KEYDOWN && event.key.keysym.sym == SDLK_SPACE) {
      direction *= -1;
    } else if (event.type == SDL_MOUSEMOTION) {
      position = static_cast<float>(event.motion.x);
    }
  }

  int width = 640;
  int height = 360;
  SDL_GetRendererOutputSize(renderer, &width, &height);
  position += static_cast<float>(direction);
  position = std::clamp(position, 40.0f, static_cast<float>(width - 40));

  SDL_SetRenderDrawColor(renderer, 12, 18, 24, 255);
  SDL_RenderClear(renderer);
  SDL_Rect player{static_cast<int>(position) - 20, height / 2 - 20, 40, 40};
  SDL_SetRenderDrawColor(renderer, 164, 255, 79, 255);
  SDL_RenderFillRect(renderer, &player);
  SDL_RenderPresent(renderer);
}
}

int main() {
  if (SDL_Init(SDL_INIT_VIDEO | SDL_INIT_GAMECONTROLLER) != 0) return 1;
  if (SDL_CreateWindowAndRenderer(640, 360, SDL_WINDOW_SHOWN, &window, &renderer) != 0) return 1;
  EM_ASM({
    document.getElementById("game-ready").hidden = false;
  });
  emscripten_set_main_loop(frame, 0, 1);
  return 0;
}
