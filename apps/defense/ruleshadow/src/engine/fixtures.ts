/* 40 synthetic rules with known defects. Zones: corp, dmz, vpn, mgmt, internet. All addresses RFC 1918 / TEST-NET. */
export const SAMPLE_RULES_CSV = `seq,id,action,src,dst,proto,ports,zoneFrom,zoneTo,enabled,owner,expires,lastHit,comment
10,CORP-DNS,allow,10.0.0.0/8,10.0.9.53/32,udp,53,corp,dmz,true,netops,,2026-09-30,Internal resolver
20,CORP-WEB-OUT,allow,10.0.0.0/8,any,tcp,"80,443",corp,internet,true,netops,,2026-09-30,Outbound web via proxy bypass
30,CORP-PROXY,allow,10.0.0.0/8,10.0.9.8/32,tcp,3128,corp,dmz,true,netops,,2026-09-30,Proxy
40,CORP-MAIL,allow,10.0.0.0/8,10.0.9.25/32,tcp,"25,587",corp,dmz,true,msgteam,,2026-09-29,Mail relay
50,CORP-NTP,allow,10.0.0.0/8,10.0.9.123/32,udp,123,corp,dmz,true,netops,,2026-09-30,Time
60,FIN-ERP,allow,10.0.4.0/24,10.0.20.15/32,tcp,8443,corp,dmz,true,finance-it,,2026-09-30,ERP front end
70,FIN-ERP-DUP,allow,10.0.4.0/25,10.0.20.15/32,tcp,8443,corp,dmz,true,finance-it,,,Duplicate of FIN-ERP (shadowed)
80,HR-PAYROLL,allow,10.0.6.0/24,10.0.20.40/32,tcp,443,corp,dmz,true,hr-it,2026-06-30,2026-09-28,Temporary access for migration (expired)
90,DEV-GIT,allow,10.0.12.0/22,10.0.30.5/32,tcp,"22,443",corp,dmz,true,platform,,2026-09-30,Git server
100,DEV-CI,allow,10.0.12.0/22,10.0.30.6/32,tcp,8080,corp,dmz,true,platform,,2026-09-30,CI
110,DEV-DB-OLD,allow,10.0.12.0/22,10.0.31.0/24,tcp,5432,corp,dmz,true,platform,,2026-04-02,Old staging DB (no hits)
120,DMZ-WEB-IN,allow,any,10.0.20.10/32,tcp,443,internet,dmz,true,webteam,,2026-09-30,Public website
130,DMZ-WEB-IN-HTTP,allow,any,10.0.20.10/32,tcp,80,internet,dmz,true,webteam,,2026-09-30,Redirect to HTTPS
140,DMZ-API-IN,allow,any,10.0.20.11/32,tcp,443,internet,dmz,true,webteam,,2026-09-30,Public API
150,DMZ-DENY-DB,deny,10.0.20.0/24,10.0.31.0/24,tcp,5432,dmz,corp,true,netsec,,2026-09-30,DMZ must not reach databases
160,DMZ-DB-LEGACY,allow,10.0.20.10/32,10.0.31.7/32,tcp,5432,dmz,corp,true,webteam,,,Legacy direct DB (conflicts with DMZ-DENY-DB)
170,VPN-DNS,allow,10.200.0.0/16,10.0.9.53/32,udp,53,vpn,dmz,true,netops,,2026-09-30,VPN resolver
180,VPN-INTRANET,allow,10.200.0.0/16,10.0.20.12/32,tcp,443,vpn,dmz,true,netops,,2026-09-30,Intranet portal
190,VPN-RDP-ALL,allow,10.200.0.0/16,10.0.0.0/8,tcp,3389,vpn,corp,true,helpdesk,,2026-09-30,RDP for support (too broad)
200,VPN-SSH-JUMP,allow,10.200.0.0/16,10.0.5.10/32,tcp,22,vpn,mgmt,true,netops,,2026-09-30,SSH to jump host
210,VPN-SMB,allow,10.200.0.0/16,10.0.40.0/24,tcp,445,vpn,corp,true,fileteam,,2026-09-21,File shares over VPN
220,VPN-CONTRACTOR,allow,10.200.50.0/24,10.0.30.6/32,tcp,8080,vpn,dmz,true,platform,2026-08-15,2026-08-10,Contractor CI access (expired)
230,MGMT-SSH,allow,10.0.5.0/24,10.0.0.0/8,tcp,22,mgmt,corp,true,netops,,2026-09-30,Admin SSH from mgmt
240,MGMT-RDP,allow,10.0.5.0/24,10.0.0.0/8,tcp,3389,mgmt,corp,true,netops,,2026-09-30,Admin RDP from mgmt
250,MGMT-SNMP,allow,10.0.5.0/24,10.0.0.0/8,udp,161,mgmt,corp,true,netops,,2026-09-30,Monitoring
260,MGMT-WINRM,allow,10.0.5.0/24,10.0.0.0/8,tcp,5985-5986,mgmt,corp,true,netops,,2026-09-30,WinRM
270,BACKUP,allow,10.0.50.0/24,10.0.0.0/8,tcp,10000-10010,corp,corp,true,backup,,2026-09-30,Backup agents
280,PRINT,allow,10.0.0.0/8,10.0.60.0/24,tcp,9100,corp,corp,true,netops,,2026-09-30,Printers
290,GUEST-DENY-CORP,deny,10.100.0.0/16,10.0.0.0/8,any,any,guest,corp,true,netsec,,2026-09-30,Guest isolation
300,GUEST-WEB,allow,10.100.0.0/16,any,tcp,"80,443",guest,internet,true,netops,,2026-09-30,Guest internet
310,GUEST-DNS,allow,10.100.0.0/16,10.0.9.53/32,udp,53,guest,dmz,true,netops,,2026-09-30,Guest DNS
320,TEMP-ANY,allow,any,any,any,any,any,any,true,unknown,,2026-09-30,Troubleshooting rule left in place
330,PARTNER-SFTP,allow,198.51.100.0/24,10.0.20.22/32,tcp,22,internet,dmz,true,integration,2027-01-31,2026-09-27,Partner SFTP drop
340,PARTNER-SFTP-OLD,allow,198.51.100.0/24,10.0.20.22/32,tcp,22,internet,dmz,true,integration,,2026-01-15,Replaced by PARTNER-SFTP (shadowed)
350,ICMP-MON,allow,10.0.5.0/24,10.0.0.0/8,icmp,any,mgmt,corp,true,netops,,2026-09-30,Ping monitoring
360,DISABLED-OLD,allow,10.0.70.0/24,10.0.20.0/24,tcp,any,corp,dmz,false,legacy,,2025-11-01,Disabled last year
370,DENY-TELNET,deny,any,any,tcp,23,any,any,true,netsec,,2026-09-30,Block telnet everywhere
380,CORP-TELNET-LEGACY,allow,10.0.8.0/24,10.0.61.0/24,tcp,23,corp,corp,true,ot-team,,2026-09-12,Legacy OT telnet (conflicts with DENY-TELNET)
390,DENY-DMZ-TO-CORP,deny,10.0.20.0/24,10.0.0.0/8,any,any,dmz,corp,true,netsec,,2026-09-30,DMZ default deny inbound
400,LOG-DENY,deny,any,any,any,any,any,any,false,netsec,,2026-09-30,Final deny (currently disabled by mistake)
`;
