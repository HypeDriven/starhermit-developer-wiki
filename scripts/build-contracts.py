#!/usr/bin/env python3
"""Build the public REST operation index and request schemas from a source checkout.

Usage: python3 scripts/build-contracts.py /path/to/platform-checkout
Only public developer routes are included. Reviewed response schemas and protocol
contracts are maintained separately; no deployment configuration is published.
"""
import argparse
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PAGES = {
    'Auth': 'auth', 'Me': 'profile', 'MePublicKeys': 'profile', 'MeEntitlements': 'profile',
    'Presence': 'profile', 'Terms': 'profile', 'Time': '../getting-started',
    'Friends': 'friends', 'Chat': 'chat', 'Voice': 'voice',
    'Software': 'catalog', 'SoftwareDownload': 'catalog', 'CloudSaves': 'catalog',
    'Wishlist': 'catalog', 'Ratings': 'catalog', 'Activity': 'activity', 'MeActivity': 'activity',
    'ExternalSoftware': 'external-libraries', 'Games': 'games', 'Realtime': 'realtime',
    'RealtimeTickets': 'auth', 'Relay': 'relay', 'GitHubGames': 'github-games',
    'GameReports': 'reports', 'GameModeration': 'moderation', 'GameDiagnostics': 'games',
    'GameWebhooks': 'games', 'Leaderboards': 'leaderboards', 'MeAchievements': 'achievements',
    'SoftwareAchievements': 'achievements', 'Publisher': 'publisher',
    'PublisherAchievements': 'publisher', 'PublisherLeaderboards': 'publisher',
    'PublisherEntitlements': 'publisher', 'Generation': '../../availability',
}


def balanced(text, start, opening='(', closing=')'):
    text = re.sub(r"'(?:\\.|[^'\\])'", lambda m: '0' * len(m[0]), text)
    depth = 0
    quoted = False
    escaped = False
    for i in range(start, len(text)):
        char = text[i]
        if quoted:
            if escaped: escaped = False
            elif char == '\\': escaped = True
            elif char == '"': quoted = False
            continue
        if char == '"': quoted = True
        elif char == opening: depth += 1
        elif char == closing:
            depth -= 1
            if not depth: return text[start + 1:i], i + 1
    raise ValueError('Unbalanced source declaration')


def split_fields(text):
    fields, start, depth = [], 0, 0
    for i, char in enumerate(text):
        if char in '<([{': depth += 1
        elif char in '>)]}': depth -= 1
        elif char == ',' and depth == 0:
            fields.append(text[start:i].strip()); start = i + 1
    fields.append(text[start:].strip())
    return [field for field in fields if field]


def no_comments(text):
    return re.sub(r'"(?:\\.|[^"\\])*"|/\*.*?\*/|//[^\n]*', lambda m: '' if m[0].startswith(('/', '*')) else m[0], text, flags=re.S)


def camel(name):
    return name[:1].lower() + name[1:]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('source', type=Path)
    args = parser.parse_args()
    declarations = {}
    source_files = list((args.source / 'src').rglob('*.cs'))
    for file in source_files:
        if 'obj' in file.parts or 'bin' in file.parts: continue
        text = no_comments(file.read_text())
        for match in re.finditer(r'public\s+(?:sealed\s+)?record\s+(\w+)\s*\(', text):
            fields, _ = balanced(text, match.end() - 1)
            declarations.setdefault(match[1], []).append((file.stem, fields, 'record'))
        for match in re.finditer(r'public\s+(?:(?:sealed|partial)\s+)*(?:class|record)\s+(\w+)\s*(?:\:[^{]+)?\{', text):
            try: body, _ = balanced(text, match.end() - 1, '{', '}')
            except ValueError as error: raise ValueError((str(file), match[1])) from error
            fields = []
            for prop in re.finditer(r'public\s+([\w.<>,?\[\] ]+)\s+(\w+)\s*\{\s*get;\s*(?:set|init);\s*\}', body):
                fields.append(prop[1].strip() + ' ' + prop[2] + ' = default')
            if fields: declarations.setdefault(match[1], []).append((file.stem, ','.join(fields), 'class'))

    schemas = {}
    def type_schema(type_name, context):
        type_name = type_name.strip()
        nullable = type_name.endswith('?')
        type_name = type_name.removesuffix('?')
        primitive = {
            'string': {'type':'string'}, 'Guid': {'type':'string','format':'uuid'},
            'DateTimeOffset': {'type':'string','format':'date-time'}, 'DateTime': {'type':'string','format':'date-time'},
            'bool': {'type':'boolean'}, 'int': {'type':'integer','format':'int32'},
            'long': {'type':'integer','format':'int64'}, 'double': {'type':'number'},
            'float': {'type':'number'}, 'decimal': {'type':'number'}, 'byte': {'type':'integer'},
            'JsonElement': {}, 'object': {}, 'PrivacyLevel': {'type':'integer','enum':[0,1,2]},
        }
        if type_name in primitive: result = primitive[type_name].copy()
        elif type_name.endswith('[]'): result = {'type':'array','items':type_schema(type_name[:-2], context)}
        elif re.match(r'(?:List|IReadOnlyList|IEnumerable|ICollection|IReadOnlyCollection|HashSet)<', type_name):
            result = {'type':'array','items':type_schema(type_name[type_name.index('<')+1:-1], context)}
        elif re.match(r'(?:Dictionary|IReadOnlyDictionary|IDictionary)<', type_name):
            value = split_fields(type_name[type_name.index('<')+1:-1])[-1]
            result = {'type':'object','additionalProperties':type_schema(value, context)}
        else:
            short = type_name.split('.')[-1]
            candidates = declarations.get(short, [])
            scope = type_name.split('.')[0] if '.' in type_name else context
            found = next((d for d in candidates if d[0] == scope), None) or (candidates[0] if candidates else None)
            if not found:
                # Open shapes are intentional for game-defined or unmodeled JSON,
                # not a fabricated set of wire fields.
                result = {}
            else:
                owner, fields, _ = found
                key = short if len(candidates) == 1 else re.sub(r'Controller|Service|\.', '', owner) + short
                if key not in schemas:
                    schemas[key] = {'type':'object','properties':{},'additionalProperties':True}
                    required = []
                    for field in split_fields(fields):
                        field = re.sub(r'\[[^]]*\]', '', field) if not field.strip().startswith(('string[]','int[]')) else field
                        match = re.match(r'([\w.<>,?\[\] ]+)\s+(\w+)\s*(?:=\s*(.*))?$', field.strip(), re.S)
                        if not match: raise ValueError((key, field))
                        typ, name, default = match.groups()
                        schemas[key]['properties'][camel(name)] = type_schema(typ, owner)
                        if not typ.strip().endswith('?') and default is None: required.append(camel(name))
                    if required: schemas[key]['required'] = required
                result = {'$ref':'#/components/schemas/' + key}
        if nullable and result:
            if '$ref' in result: result = {'allOf':[result], 'nullable':True}
            else: result['nullable'] = True
        return result

    paths, inventory = {}, []
    for file in sorted((args.source / 'src/Platform.Api/Controllers').glob('*Controller.cs')):
        controller = file.stem.removesuffix('Controller')
        if controller not in PAGES: continue
        text = no_comments(file.read_text())
        class_match = re.search(r'public\s+(?:sealed\s+)?class\s+\w+Controller', text)
        class_prefix = text[:class_match.start()] if class_match else text
        bases = re.findall(r'\[Route\("([^"]*)"\)\]', class_prefix)
        base = bases[-1] if bases else ''
        authenticated = '[Authorize' in class_prefix
        for match in re.finditer(r'\[Http(Get|Post|Put|Patch|Delete)(?:\("([^"]*)"(?:,[^]]*)?\))?\]', text):
            action = re.search(r'public\s+(?:async\s+)?[\w<>,?.\[\] ]+\s+(\w+)\s*\(', text[match.end():])
            if not action: raise ValueError((file, match[0]))
            action_start = match.end() + action.start()
            signature, signature_end = balanced(text, match.end() + action.end() - 1)
            method_name = action[1]
            previous_end = text.rfind('}', 0, match.start())
            attrs = text[previous_end+1:action_start]
            suffix = match[2] or ''
            route = suffix.removeprefix('~/') if suffix.startswith(('api/', 'ws/', '~/')) else '/'.join(p for p in [base,suffix] if p)
            route = '/' + route.replace('{version:apiVersion}','1').lstrip('/')
            constraints = dict(re.findall(r'\{(\w+):([^}]+)\}', route))
            route = re.sub(r'\{(\w+):[^}]+\}', r'{\1}', route)
            if not route.startswith('/api/v1/'): raise ValueError((file, route))
            verb = match[1].lower()
            doc_page = PAGES[controller]
            page_url = 'https://wiki.starhermit.com/docs/api/' + doc_page + '.html'
            page_url = page_url.replace('/docs/api/../getting-started','/docs/getting-started').replace('/docs/api/../../availability','/docs/availability')
            op = {
                'operationId': verb + '_' + re.sub(r'[^a-zA-Z0-9]+', '_', route.removeprefix('/api/v1/')).strip('_'),
                'summary': re.sub(r'(?<!^)(?=[A-Z])',' ', method_name),
                'tags':[doc_page.split('/')[-1]],
                'description':'See the linked reference for response fields, resource authorization, limits, and endpoint-specific errors.',
                'externalDocs': {'description':'API reference', 'url':page_url},
                'parameters':[],
                'responses':{'default': {'description':'Response status and body as documented in the linked API reference.'}},
            }
            anonymous = '[AllowAnonymous]' in attrs or not authenticated and '[Authorize' not in attrs
            if not anonymous: op['security'] = [{'bearerAuth':[]}]
            else: op['security'] = []
            credential = ['anonymous'] if anonymous else ['account']
            if not anonymous and (controller in ('Realtime','RealtimeTickets','Relay') or controller == 'Games' and route.startswith('/api/v1/games/') or '/games/{slug}/' in route or '/me/cloud-saves/' in route):
                credential.append('player-launch')
            if route.endswith('/me/terms/accept') or route.endswith('/me/heartbeat') or route.endswith('/me/friends') or re.match(r'/api/v1/users/.+/(?:profile|avatar)$',route):
                credential.append('player-launch')
            if '/server/sessions/' in route: credential = ['container-server']
            if '/server/token' in route:
                credential = ['deployment-refresh-key']
                op['security'] = [{'deploymentRefreshKey':[]}]
                op['parameters'].append({'name':'X-Starhermit-Refresh-Key','in':'header','required':True,'schema':{'type':'string'}})
            if '/moderation' in route and '/games/' in route:
                if not route.endswith('/flags'): credential.append('container-server')
            if route.endswith('/public-keys/current'): credential = ['public-key-account']
            elif (controller == 'MePublicKeys' and verb != 'get'): credential = ['oauth-account']
            op['x-credentials'] = list(dict.fromkeys(credential))
            policies = re.findall(r'Authorize\(Policy\s*=\s*"([^"]+)"', class_prefix + attrs)
            if policies: op['x-required-policies'] = policies
            body_type = None
            for field in split_fields(signature):
                part = re.match(r'((?:\[[^]]+\]\s*)*)([\w.<>,?\[\] ]+)\s+(\w+)\s*(?:=\s*(.*))?$', field, re.S)
                if not part: raise ValueError((controller, method_name, field))
                annotations, typ, name, default = part.groups()
                typ = typ.strip()
                if 'FromServices' in annotations or typ in ('CancellationToken','HttpContext'): continue
                if 'FromBody' in annotations:
                    body_type = typ
                    op['requestBody'] = {'required':True,'content':{'application/json':{'schema':type_schema(typ, controller+'Controller')}}}
                    continue
                if name in re.findall(r'\{(\w+)\}', route):
                    op['parameters'].append({'name':name,'in':'path','required':True,'schema':type_schema('Guid' if constraints.get(name)=='guid' else typ, controller+'Controller')})
                else:
                    schema = type_schema(typ, controller+'Controller')
                    schema.pop('nullable', None)
                    if default is not None and default in ('true','false'): schema['default'] = default == 'true'
                    elif default is not None and re.fullmatch(r'\d+', default): schema['default'] = int(default)
                    elif default is not None and re.fullmatch(r'"[^"]*"', default): schema['default'] = default[1:-1]
                    parameter = {'name':name,'in':'query','required':not typ.endswith('?') and default is None,'schema':schema}
                    if schema.get('type') == 'array': parameter.update(style='form',explode=True)
                    op['parameters'].append(parameter)
            # Catch path parameters on reservation methods which do not consume them.
            present = {p['name'] for p in op['parameters'] if p['in']=='path'}
            for name in re.findall(r'\{(\w+)\}',route):
                if name not in present: op['parameters'].append({'name':name,'in':'path','required':True,'schema':{'type':'string'}})
            if controller == 'GitHubGames' and method_name in ('Upload','PushBundle','UploadBundle','CreateFromFolder'):
                op['requestBody'] = {'required':True,'content':{'application/gzip':{'schema':{'type':'string','format':'binary'}}}}
            if controller == 'Generation':
                op['x-availability'] = 'reserved-unavailable'
                op['description'] = 'Reserved, unavailable API. Valid callers receive 503 overloaded; no generation or purchase behavior is available.'
                op['responses'] = {'503': {'description':'Unavailable; Retry-After: 300','content':{'application/json':{'schema':{'$ref':'#/components/schemas/Unavailable'}}}}}
                if '/games/' in route: op['x-credentials'] = ['account','player-launch','container-server']
            paths.setdefault(route, {})
            assert verb not in paths[route], (route, verb)
            paths[route][verb] = op
            inventory.append((controller,method_name,verb,route,body_type))
    schemas['Unavailable'] = {'type':'object','properties':{'error':{'type':'string','enum':['overloaded']},'code':{'type':'string','enum':['overloaded']},'retryAfterSeconds':{'type':'integer','example':300}},'required':['error','code','retryAfterSeconds']}
    document = {
        'openapi':'3.0.3',
        'info':{'title':'StarHermit public REST API','version':'1','description':'Public REST operation index and JSON request shapes. Read externalDocs for response details and endpoint-specific rules. Game-owned JSON remains open. Reserved generation routes are marked unavailable.'},
        'servers':[{'url':'https://api.starhermit.com'}],
        'paths':dict(sorted(paths.items())),
        'components':{'securitySchemes':{'bearerAuth':{'type':'http','scheme':'bearer','bearerFormat':'JWT'},'deploymentRefreshKey':{'type':'apiKey','in':'header','name':'X-Starhermit-Refresh-Key'}},'schemas':dict(sorted(schemas.items()))},
    }
    # Reviewed response contracts and validation constraints augment the operation index.
    overlay = ROOT / 'scripts/rest-contract-overrides.json'
    if overlay.exists():
        patch = json.loads(overlay.read_text())
        for key, typ in patch.get('modelTypes', {}).items():
            resolved = type_schema(typ, '')
            document['components']['schemas'][key] = resolved

        for key, value in schemas.items(): document['components']['schemas'].setdefault(key, value)
        document['components']['schemas'].update(patch.get('schemas',{}))
        for route, operations in patch.get('responses', {}).items():
            for verb, definitions in operations.items():
                operation = document['paths'][route][verb]
                operation['responses'] = {}
                for status, definition in definitions.items():
                    description = definition.get('description', 'Success')
                    result = {'description': description}
                    if 'type' in definition:
                        schema = type_schema(definition['type'], '')
                        result['content'] = {'application/json': {'schema': schema}}
                    if 'schema' in definition:
                        result['content'] = {definition.get('contentType', 'application/json'): {'schema': definition['schema']}}
                    operation['responses'][status] = result
                operation['responses']['default'] = {'description':'Endpoint-specific errors; JSON, plain text, validation problem, or empty response as documented.'}

        for key, value in schemas.items(): document['components']['schemas'].setdefault(key, value)
        for route, operations in patch.get('paths',{}).items():
            for verb, changes in operations.items():
                assert route in document['paths'] and verb in document['paths'][route], (route,verb)
                document['paths'][route][verb].update(changes)
    (ROOT / 'docs/contracts/openapi.json').write_text(json.dumps(document,indent=2)+'\n')
    Path('/tmp/starhermit-contract-inventory.json').write_text(json.dumps(inventory,indent=2))
    print(f'{sum(map(len,paths.values()))} REST operations, {len(document["components"]["schemas"])} schemas')

if __name__ == '__main__': main()
