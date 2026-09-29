#!/usr/bin/env python3
import json, os, pathlib, plistlib, subprocess, sys, tempfile, urllib.parse, zipfile
ipa, build = sys.argv[1:]
with zipfile.ZipFile(ipa) as archive:
    roots={name.split('/')[1] for name in archive.namelist() if name.startswith('Payload/') and '.app/' in name}
    assert len(roots)==1, 'Expected one application'
    root='Payload/'+roots.pop()+'/'
    info=plistlib.loads(archive.read(root+'Info.plist'))
    config=plistlib.loads(archive.read(root+'ClientConfiguration.plist'))
    assert info['CFBundleIdentifier']=='com.artempaskov.aisy'
    assert info['CFBundleVersion']==build
    assert info['ITSAppUsesNonExemptEncryption'] is False
    assert info.get('CFBundleIcons',{}).get('CFBundlePrimaryIcon',{}).get('CFBundleIconName')=='AppIcon'
    assert config['APIBaseURL']==os.environ['NEGRONI_API_URL'].strip().rstrip('/'), 'Bundled gateway differs from the release configuration'
    url=urllib.parse.urlsplit(config['APIBaseURL'])
    assert url.scheme=='https' and url.hostname not in ('localhost','127.0.0.1','::1')
    assert not info.get('NSAppTransportSecurity',{}).get('NSAllowsArbitraryLoads',False)
    assert any(name.endswith('NegroniMascot.png') for name in archive.namelist())
    assert not any(any(part in name.lower() for part in ('react.framework','hermes.framework','expo.framework','main.jsbundle')) for name in archive.namelist()), 'Cross-platform runtime found in native bundle'
    with tempfile.TemporaryDirectory() as directory:
        profile=pathlib.Path(directory)/'profile.mobileprovision'
        profile.write_bytes(archive.read(root+'embedded.mobileprovision'))
        value=plistlib.loads(subprocess.check_output(['security','cms','-D','-i',str(profile)],stderr=subprocess.DEVNULL))
        entitlements=value['Entitlements']
        assert entitlements.get('beta-reports-active') is True
        assert entitlements.get('get-task-allow') is False
        assert entitlements.get('aps-environment')=='production'
        assert entitlements.get('com.apple.developer.applesignin')==['Default']
    print(json.dumps({'bundle':info['CFBundleIdentifier'],'version':info['CFBundleShortVersionString'],'build':build,'nativeUIKit':True,'productionGateway':True,'storeProfile':True,'encryptionCompliance':True,'ipaBytes':os.path.getsize(ipa)}))
