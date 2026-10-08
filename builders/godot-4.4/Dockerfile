FROM flashlight13/godot:4.4@sha256:bb0dc52ab4e77528cac72a8707ed043b8c179370a91ce0825e2bc124a41f8cab
USER root
RUN apt-get update \
  && apt-get install --yes --no-install-recommends ca-certificates curl libfontconfig1 unzip \
  && rm -rf /var/lib/apt/lists/*
RUN mkdir -p /opt/godot-templates \
  && curl --fail --silent --show-error --location \
    https://github.com/godotengine/godot/releases/download/4.4-stable/Godot_v4.4-stable_export_templates.tpz \
    --output /tmp/export-templates.tpz \
  && echo "ce5801d2868f8217eb200b402918494184486dab0ea7be97f9ffab73b9283241b6e8c2e3b4ae58218b09b56743449f1d55240f9db50a045efe6186aea0fd8c2c  /tmp/export-templates.tpz" | sha512sum --check \
  && unzip -q /tmp/export-templates.tpz -d /opt/godot-templates \
  && rm /tmp/export-templates.tpz
RUN useradd --create-home --uid 1000 builder
COPY builders/godot/build.sh /usr/local/bin/game2web-build
RUN chmod +x /usr/local/bin/game2web-build
USER builder
WORKDIR /src
ENV XDG_DATA_HOME=/tmp/godot-data
ENV XDG_CONFIG_HOME=/tmp/godot-config
ENV XDG_CACHE_HOME=/tmp/godot-cache
ENV GODOT_TEMPLATE_VERSION=4.4
ENTRYPOINT ["/usr/local/bin/game2web-build"]
