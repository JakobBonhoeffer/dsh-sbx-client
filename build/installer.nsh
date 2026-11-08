; Custom NSIS logic for the electron-builder installer (picked up automatically from build/).
;
; Goal: install into exactly the folder shown in the directory field. electron-builder would
; silently append "\<app name>" to it, because its uninstaller deletes the whole install folder.
; To keep that safe without the hidden subfolder:
;   - an empty or new folder, or an existing install of this app, is used as chosen
;   - a non-empty foreign folder gets the app subfolder after an explicit confirmation
;   - the uninstaller only deletes the entries listed in install-manifest.txt
;     (written at build time by scripts/after-pack.cjs) and removes the folder only if empty

; --- Install side ---------------------------------------------------------------------------

!macro customPageAfterChangeDir
  ; Replace electron-builder's instFilesPre (it always appends the app name) with our own.
  ; This macro runs after its "!define MUI_PAGE_CUSTOMFUNCTION_PRE" and before the page that uses it.
  !ifdef MUI_PAGE_CUSTOMFUNCTION_PRE
    !undef MUI_PAGE_CUSTOMFUNCTION_PRE
  !endif
  !define MUI_PAGE_CUSTOMFUNCTION_PRE dshInstFilesPre

  ; Sets $R9 to "1" when $INSTDIR exists and contains anything, otherwise "0".
  Function dshDirHasFiles
    StrCpy $R9 "0"
    ${IfNot} ${FileExists} "$INSTDIR\*.*"
      Return
    ${EndIf}
    Push $R0
    Push $R1
    FindFirst $R0 $R1 "$INSTDIR\*.*"
    dshLoop:
      StrCmp $R1 "" dshDone
      StrCmp $R1 "." dshNext
      StrCmp $R1 ".." dshNext
      StrCpy $R9 "1"
      Goto dshDone
    dshNext:
      FindNext $R0 $R1
      Goto dshLoop
    dshDone:
    FindClose $R0
    Pop $R1
    Pop $R0
  FunctionEnd

  Function dshInstFilesPre
    ; An existing install of this app (upgrade or reinstall) is used as it is.
    ${If} ${FileExists} "$INSTDIR\${UNINSTALL_FILENAME}"
      Return
    ${EndIf}

    Call dshDirHasFiles
    ${If} $R9 == "0"
      Return
    ${EndIf}

    ; Not empty and not ours: never install straight into it, because other files live there.
    StrCpy $R8 "$INSTDIR\${APP_FILENAME}"
    MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "The selected folder is not empty.$\r$\n$\r$\nTo keep its files safe, $(^Name) will be installed into this subfolder instead:$\r$\n$R8" /SD IDOK IDOK dshUseSubfolder
    Quit
    dshUseSubfolder:
    StrCpy $INSTDIR $R8
    Return

    ; Never executed. electron-builder compiles NSIS with warnings as errors, and its own
    ; instFilesPre is no longer referenced as a page callback, so reference it here.
    Call instFilesPre
  FunctionEnd
!macroend

; Silent installs (/S, optionally with /D=<folder>) skip all pages, so the page callback above never
; runs. Apply the same folder rule at startup in that case (the confirmation is auto-accepted).
!macro customInit
  ${If} ${Silent}
    Call dshInstFilesPre
  ${EndIf}
!macroend

; --- Uninstall side -------------------------------------------------------------------------

!macro customRemoveFiles
  ; Move out of $INSTDIR so it can be removed.
  SetOutPath $TEMP

  ${If} ${FileExists} "$INSTDIR\install-manifest.txt"
    FileOpen $R0 "$INSTDIR\install-manifest.txt" r
    dshManifestLoop:
      FileRead $R0 $R1
      StrCmp $R1 "" dshManifestDone

      ; Strip the line break (CRLF or LF).
      StrCpy $R2 $R1 1 -1
      ${If} $R2 == "$\n"
        StrCpy $R1 $R1 -1
      ${EndIf}
      StrCpy $R2 $R1 1 -1
      ${If} $R2 == "$\r"
        StrCpy $R1 $R1 -1
      ${EndIf}

      StrCpy $R3 $R1 2
      StrCpy $R4 $R1 "" 2
      ${If} $R4 != ""
        ${If} $R3 == "D:"
          RMDir /r "$INSTDIR\$R4"
        ${ElseIf} $R3 == "F:"
          Delete "$INSTDIR\$R4"
        ${EndIf}
      ${EndIf}
      Goto dshManifestLoop
    dshManifestDone:
    FileClose $R0
    Delete "$INSTDIR\install-manifest.txt"
  ${Else}
    DetailPrint "No install manifest found; only the uninstaller itself is removed."
  ${EndIf}

  Delete "$INSTDIR\${UNINSTALL_FILENAME}"
  Delete "$INSTDIR\uninstallerIcon.ico"

  ; The app writes its own log files to "logs" next to the program. That folder belongs to the
  ; app (it is not part of the install manifest), so it is removed explicitly, and only it.
  RMDir /r "$INSTDIR\logs"

  ; Non-recursive: removes the folder only if nothing else is left in it.
  RMDir "$INSTDIR"
!macroend
