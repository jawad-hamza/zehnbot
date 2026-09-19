proxy_http_version 1.1;
proxy_set_header Host $host;
# The visitor's address, exactly as the server's nginx established it. Passed on unchanged: the web
# container trusts it only because this edge sits on Docker's private network.
proxy_set_header X-Forwarded-For $http_x_forwarded_for;
proxy_set_header X-Real-IP $http_x_real_ip;
proxy_set_header X-Forwarded-Proto $zb_forwarded_proto;

# A container that is stopping refuses at once; one that is gone does not answer at all. Either way
# the request never arrived, so after 2 seconds at most it goes to the candidate instead, POSTs included.
proxy_connect_timeout 2s;
proxy_send_timeout 130s;
# (proxy_read_timeout is set per location: 130s normally, 300s for streamed chat replies)
proxy_next_upstream error timeout http_502 http_503 http_504;
proxy_next_upstream_tries 2;
proxy_next_upstream_timeout 15s;
