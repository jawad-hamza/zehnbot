upstream zehnbot_web {
    zone zehnbot_web 64k;
    server admin:80 resolve max_fails=0;
    server admin-candidate:80 resolve backup max_fails=0;
}
