FROM emscripten/emsdk:3.1.74
RUN apt-get update && apt-get install -y --no-install-recommends cmake ninja-build libsdl2-dev && rm -rf /var/lib/apt/lists/*
RUN useradd --create-home --uid 1000 builder
COPY build.sh /usr/local/bin/game2web-build
RUN chmod +x /usr/local/bin/game2web-build
USER builder
WORKDIR /src
ENTRYPOINT ["/usr/local/bin/game2web-build"]
