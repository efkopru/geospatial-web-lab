# nginx (scripts/nginx.conf) gives Rails the client address in X-Forwarded-For and the scheme in
# X-Forwarded-Proto. Rack would otherwise prefer the standard Forwarded header, which nginx does
# not write, so a client could send its own and choose the address that request.remote_ip
# reports: the address failed sign-ins are counted against. Rails 8.1.4.1 refuses a Forwarded
# header that contradicts X-Forwarded-For only when the client's own address is public.
#
# Only the X-Forwarded-* headers are read here, so a Forwarded header changes nothing. nginx also
# removes it before the request reaches Rails.
Rack::Request.forwarded_priority = [:x_forwarded]
