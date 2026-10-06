FROM barichello/godot-ci:4.3.0
RUN useradd --create-home --uid 1000 builder
COPY build.sh /usr/local/bin/game2web-build
RUN chmod +x /usr/local/bin/game2web-build
USER builder
WORKDIR /src
ENTRYPOINT ["/usr/local/bin/game2web-build"]
