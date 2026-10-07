FROM emscripten/emsdk:3.1.74
RUN apt-get update && apt-get install -y --no-install-recommends cmake ninja-build && rm -rf /var/lib/apt/lists/*
ENV EMSCRIPTEN_VERSION=3.1.74
ENV SDL_VERSION=emscripten-built-in-sdl2
COPY build.sh /usr/local/bin/game2web-build
RUN chmod +x /usr/local/bin/game2web-build
USER 1000:1000
WORKDIR /src
ENTRYPOINT ["/usr/local/bin/game2web-build"]
