FROM flashlight13/godot:4.3
USER root
RUN apt-get update \
  && apt-get install --yes --no-install-recommends ca-certificates curl libfontconfig1 unzip \
  && rm -rf /var/lib/apt/lists/*
RUN mkdir -p /opt/godot-templates \
  && curl --fail --silent --show-error --location \
    https://github.com/godotengine/godot/releases/download/4.3-stable/Godot_v4.3-stable_export_templates.tpz \
    --output /tmp/export-templates.tpz \
  && unzip -q /tmp/export-templates.tpz -d /opt/godot-templates \
  && rm /tmp/export-templates.tpz
RUN useradd --create-home --uid 1000 builder
COPY build.sh /usr/local/bin/game2web-build
RUN chmod +x /usr/local/bin/game2web-build
USER builder
WORKDIR /src
ENV XDG_DATA_HOME=/tmp/godot-data
ENV XDG_CONFIG_HOME=/tmp/godot-config
ENV XDG_CACHE_HOME=/tmp/godot-cache
ENTRYPOINT ["/usr/local/bin/game2web-build"]
