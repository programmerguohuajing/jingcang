ARG DOCKER_CLI_IMAGE=docker:29-cli
FROM ${DOCKER_CLI_IMAGE}

LABEL org.opencontainers.image.title="JingCang Browser Bundle" \
      org.opencontainers.image.description="Offline Selenium browser image bundle for JingCang production deployment"

WORKDIR /opt/jingcang
COPY browsers.tar /opt/jingcang/browsers.tar
COPY preload.sh /usr/local/bin/jingcang-browser-preload
RUN chmod +x /usr/local/bin/jingcang-browser-preload

ENTRYPOINT ["/usr/local/bin/jingcang-browser-preload"]
