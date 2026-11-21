; Windows installer additions (electron-builder's "nsis.include"). The installer runs with admin rights
; (perMachine), so it can let the bridge through Windows Firewall: without this, Windows asks on the first
; start, and a Cancel there leaves a rule that blocks it, so Discovery hears no replies (ArtPoll on UDP 6454,
; mDNS) and devices can't reach remote control. Sending Art-Net, sACN and DDP needs no rule.
; electron-builder runs the old version's uninstaller first (customUnInstall, rule removed), then copies the
; files, then customInstall: an update ends with exactly one rule for the new files.

!define NOUPIX_BRIDGE "resources\bridge\noupix-bridge.exe"
!define NOUPIX_RULE "nouPix"

; Removes every rule Windows Firewall has for that program: ours, and the allow or block rules a click on
; Windows' own question made.
!macro noupixDropRules PROGRAM
  nsExec::Exec '"$SYSDIR\netsh.exe" advfirewall firewall delete rule name=all program="${PROGRAM}"'
  Pop $0
!macroend

!macro customInstall
  Push $0
  Push $1
  !insertmacro noupixDropRules "$INSTDIR\${NOUPIX_BRIDGE}"
  ; An install for this user only (1.6.3 and before) is removed just before this; its rules go too. It was in
  ; a folder named after the package (noupix-desktop), where this one is named after the product (nouPix).
  ReadEnvStr $1 LOCALAPPDATA
  ${if} $1 != ""
    !insertmacro noupixDropRules "$1\Programs\${APP_PACKAGE_NAME}\${NOUPIX_BRIDGE}"
  ${endIf}
  ; Every network type: a computer cabled straight to a controller is often on an "unidentified network",
  ; which Windows counts as public. The bridge only listens where it needs to (UDP 6454 for replies, the
  ; remote control port when that is on); its own interface stays on 127.0.0.1.
  nsExec::Exec '"$SYSDIR\netsh.exe" advfirewall firewall add rule name="${NOUPIX_RULE}" dir=in action=allow program="$INSTDIR\${NOUPIX_BRIDGE}" enable=yes profile=any description="Lets nouPix find Art-Net, sACN and WLED devices and be reached for remote control."'
  Pop $0
  ${if} $0 != 0
    DetailPrint "Windows Firewall rule not added ($0): Windows will ask the first time nouPix starts."
  ${endIf}
  Pop $1
  Pop $0
!macroend

!macro customUnInstall
  Push $0
  !insertmacro noupixDropRules "$INSTDIR\${NOUPIX_BRIDGE}"
  Pop $0
!macroend
