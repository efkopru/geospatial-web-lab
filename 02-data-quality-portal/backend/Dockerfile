# Gems with native extensions are compiled in this stage; the runtime image below receives
# the installed gems without the compiler toolchain and development headers.
FROM ruby:3.4-slim-trixie AS gems
RUN apt-get update -qq && apt-get install -y --no-install-recommends build-essential libpq-dev libyaml-dev && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY Gemfile Gemfile.lock ./
RUN bundle config set frozen true && bundle install && rm -rf /usr/local/bundle/cache

FROM ruby:3.4-slim-trixie
RUN apt-get update -qq && apt-get install -y --no-install-recommends libpq5 libyaml-0-2 postgresql-client-17 curl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=gems /usr/local/bundle /usr/local/bundle
COPY . .
RUN groupadd --system rails && useradd --system --gid rails --home-dir /app rails \
 && mkdir -p tmp/pids log && chmod +x bin/rails \
 && chown -R rails:rails /app
USER rails
ENV RAILS_ENV=production PORT=3000
EXPOSE 3000
CMD ["sh", "-c", "rm -f tmp/pids/server.pid && exec bundle exec rails server -b 0.0.0.0"]
