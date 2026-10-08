FROM emscripten/emsdk:3.1.74@sha256:af45409f3199d88db4b1b03af0098532c8fb33a375ac257463eeb0a622870d06
RUN apt-get update && apt-get install -y --no-install-recommends cmake ninja-build && rm -rf /var/lib/apt/lists/*
ENV EMSCRIPTEN_VERSION=3.1.74
ENV SDL_VERSION=emscripten-built-in-sdl2
RUN mkdir -p /opt/emscripten-cache \
    && printf 'int main(void) { return 0; }\n' > /tmp/emscripten-cache-probe.c \
    && EM_CACHE=/opt/emscripten-cache emcc -sUSE_SDL=2 -c /tmp/emscripten-cache-probe.c -o /tmp/emscripten-cache-probe.o \
    && rm -f /tmp/emscripten-cache-probe.c /tmp/emscripten-cache-probe.o
COPY build.sh /usr/local/bin/game2web-build
RUN chmod +x /usr/local/bin/game2web-build
USER 1000:1000
WORKDIR /src
ENTRYPOINT ["/usr/local/bin/game2web-build"]
