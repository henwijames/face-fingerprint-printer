/* ==========================================================================
   Client Logic (Frontend Only) - WebAuthn API Tester Playground
   ========================================================================== */

// Keep track of logs and their payloads
let logsRegistry = [];
let currentLogIndex = 0;

// Temporary in-memory session to hold current challenge and metadata
let mockSession = {
  currentChallenge: null,
  username: null
};

// Base64URL and ArrayBuffer Conversion Helpers
function bufferToBase64Url(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64 = btoa(binary);
  return base64
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

function base64UrlToBuffer(base64url) {
  let base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

// LocalStorage Database Helpers
function getLocalDb() {
  const db = localStorage.getItem('webauthn_db');
  return db ? JSON.parse(db) : {};
}

function saveLocalDb(db) {
  localStorage.setItem('webauthn_db', JSON.stringify(db));
}

// Check browser support and update status panel
async function checkBrowserSupport() {
  const webauthnBadge = document.getElementById('support-webauthn');
  const platformBadge = document.getElementById('support-platform');
  const secureBadge = document.getElementById('support-secure');
  
  // 1. WebAuthn Support Check
  const hasWebAuthn = !!window.PublicKeyCredential;
  if (hasWebAuthn) {
    webauthnBadge.innerText = 'Supported';
    webauthnBadge.className = 'badge badge-supported';
  } else {
    webauthnBadge.innerText = 'Not Supported';
    webauthnBadge.className = 'badge badge-unsupported';
  }

  // 2. Platform Authenticator Support Check (Biometrics)
  if (hasWebAuthn) {
    try {
      const isPlatformAvailable = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
      if (isPlatformAvailable) {
        platformBadge.innerText = 'Available (Biometrics Enabled)';
        platformBadge.className = 'badge badge-supported';
      } else {
        platformBadge.innerText = 'Unavailable / Disabled';
        platformBadge.className = 'badge badge-unsupported';
      }
    } catch (e) {
      platformBadge.innerText = 'Check Error';
      platformBadge.className = 'badge badge-unsupported';
    }
  } else {
    platformBadge.innerText = 'Not Supported';
    platformBadge.className = 'badge badge-unsupported';
  }

  // 3. Secure Context Check (HTTPS/localhost is required by WebAuthn)
  const isSecure = window.isSecureContext;
  if (isSecure) {
    secureBadge.innerText = 'Secure (Yes)';
    secureBadge.className = 'badge badge-supported';
  } else {
    secureBadge.innerText = 'Insecure Context (No)';
    secureBadge.className = 'badge badge-unsupported';
    log('[WARNING] App is running in an insecure context. WebAuthn registration/login will fail unless served over localhost or HTTPS.', 'error');
  }

  // 4. WebUSB Support Check
  const usbBadge = document.getElementById('support-usb');
  if (navigator.usb) {
    usbBadge.innerText = 'Supported';
    usbBadge.className = 'badge badge-supported';
  } else {
    usbBadge.innerText = 'Not Supported';
    usbBadge.className = 'badge badge-unsupported';
  }

  // 5. Web Serial Support Check
  const serialBadge = document.getElementById('support-serial');
  if (navigator.serial) {
    serialBadge.innerText = 'Supported';
    serialBadge.className = 'badge badge-supported';
  } else {
    serialBadge.innerText = 'Not Supported';
    serialBadge.className = 'badge badge-unsupported';
  }
}

// Log utility that displays events in console panel
function log(message, type = 'system', jsonPayload = null) {
  const container = document.getElementById('console-logs-output');
  const logLine = document.createElement('div');
  logLine.className = `log-line ${type}`;
  
  const timestamp = new Date().toLocaleTimeString();
  logLine.innerHTML = `[${timestamp}] ${message}`;
  
  // Store JSON metadata for inspection
  const index = currentLogIndex++;
  logsRegistry[index] = jsonPayload;
  
  // Make lines with JSON payloads clickable
  if (jsonPayload) {
    logLine.classList.add(type === 'input' ? 'input' : 'output');
    logLine.style.cursor = 'pointer';
    logLine.title = 'Click to inspect raw JSON payload';
    logLine.addEventListener('click', () => {
      viewJson(jsonPayload, type === 'input' ? 'WebAuthn Config / Client Params' : 'WebAuthn Response / Verification Details');
      
      // Highlight selected log line
      document.querySelectorAll('.log-line').forEach(el => el.style.background = 'transparent');
      logLine.style.background = type === 'input' ? 'rgba(6, 182, 212, 0.12)' : 'rgba(139, 92, 246, 0.12)';
    });
  }

  container.appendChild(logLine);
  container.scrollTop = container.scrollHeight;

  // Proactively auto-view the latest payload
  if (jsonPayload) {
    viewJson(jsonPayload, type === 'input' ? 'WebAuthn Config / Client Params' : 'WebAuthn Response / Verification Details');
  }
}

// Syntax highlight JSON output
function syntaxHighlightJson(jsonObj) {
  let jsonStr = typeof jsonObj === 'string' ? jsonObj : JSON.stringify(jsonObj, null, 2);
  
  jsonStr = jsonStr.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  
  return jsonStr.replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g, function (match) {
    let cls = 'json-number';
    if (/^"/.test(match)) {
      if (/:$/.test(match)) {
        cls = 'json-key';
      } else {
        cls = 'json-string';
      }
    } else if (/true|false/.test(match)) {
      cls = 'json-boolean';
    } else if (/null/.test(match)) {
      cls = 'json-null';
    }
    return `<span class="${cls}">${match}</span>`;
  });
}

// Render JSON in viewer
function viewJson(jsonObj, title = 'JSON Payload Viewer') {
  const viewer = document.getElementById('json-output-viewer');
  document.getElementById('json-title-text').innerText = title;
  
  if (jsonObj) {
    viewer.innerHTML = syntaxHighlightJson(jsonObj);
  } else {
    viewer.innerHTML = 'Select a step or log entry to view the raw JSON payload details here...';
  }
}

// Flow Visualizer controls
function updateFlowDiagram(activeActor, activeArrow, arrowLabelText, flowDescription, mode = 'cyan') {
  // Clear all states
  document.querySelectorAll('.flow-actor').forEach(el => el.classList.remove('active', 'violet'));
  document.querySelectorAll('.flow-arrow').forEach(el => el.classList.remove('active', 'violet', 'left-dir'));
  
  // Set mode classes
  if (activeActor) {
    const actorEl = document.getElementById(activeActor);
    if (actorEl) {
      actorEl.classList.add('active');
      if (mode === 'violet') actorEl.classList.add('violet');
    }
  }
  
  if (activeArrow) {
    const arrowEl = document.getElementById(activeArrow);
    if (arrowEl) {
      arrowEl.classList.add('active');
      if (mode === 'violet') arrowEl.classList.add('violet');
      
      // Handle direction
      if (activeArrow === 'flow-arrow-options') {
        arrowEl.classList.remove('left-dir');
      } else if (activeArrow === 'flow-arrow-create') {
        arrowEl.classList.add('left-dir');
      } else if (activeArrow === 'flow-arrow-response') {
        arrowEl.classList.remove('left-dir');
      } else if (activeArrow === 'flow-arrow-verify') {
        arrowEl.classList.remove('left-dir');
      }
      
      if (arrowLabelText) {
        arrowEl.querySelector('.arrow-label').innerText = arrowLabelText;
      }
    }
  }

  // Update desc text
  document.getElementById('flow-step-desc').innerHTML = flowDescription;
}

// Load database status from LocalStorage
function fetchDatabase() {
  const db = getLocalDb();
  const tableBody = document.querySelector('#db-table-element tbody');
  tableBody.innerHTML = '';
  
  const users = Object.keys(db);
  if (users.length === 0) {
    tableBody.innerHTML = `<tr><td colspan="7" class="empty-table">No credentials registered yet. Use the workbench to register.</td></tr>`;
    return;
  }

  users.forEach(username => {
    const user = db[username];
    if (user.credentials.length === 0) {
      tableBody.innerHTML += `
        <tr>
          <td class="cred-id-cell">${user.id}</td>
          <td><strong>${username}</strong></td>
          <td colspan="5" style="color: var(--text-muted); font-style: italic;">No registered devices</td>
        </tr>
      `;
    } else {
      user.credentials.forEach((cred, idx) => {
        const formattedDate = new Date(cred.createdAt).toLocaleString();
        tableBody.innerHTML += `
          <tr>
            ${idx === 0 ? `<td class="cred-id-cell" rowspan="${user.credentials.length}">${user.id}</td>` : ''}
            ${idx === 0 ? `<td rowspan="${user.credentials.length}"><strong>${username}</strong></td>` : ''}
            <td class="cred-id-cell" title="${cred.credentialID}">${cred.credentialID}</td>
            <td class="pubkey-cell" title="${cred.credentialPublicKey}">${cred.credentialPublicKey}</td>
            <td style="text-align: center; font-family: var(--font-mono); font-weight: 600;">${cred.counter}</td>
            <td><span class="badge" style="background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1);">${cred.transports.join(', ') || 'none'}</span></td>
            <td style="font-size: 0.8rem; color: var(--text-secondary);">${formattedDate}</td>
          </tr>
        `;
      });
    }
  });
}

// WebUSB Printer Port Functions
async function scanUsbDevices() {
  if (!navigator.usb) {
    log('[USB] WebUSB API is not supported in this browser.', 'error');
    return;
  }
  try {
    log('[USB] Opening browser USB device chooser...', 'info');
    const device = await navigator.usb.requestDevice({ filters: [] });
    log(`[USB-SUCCESS] Paired device: ${device.productName || 'Unknown Device'}`, 'success', {
      productName: device.productName,
      vendorId: `0x${device.vendorId.toString(16).toUpperCase().padStart(4, '0')}`,
      productId: `0x${device.productId.toString(16).toUpperCase().padStart(4, '0')}`,
      manufacturerName: device.manufacturerName,
      deviceClass: device.deviceClass,
      deviceSubclass: device.deviceSubclass
    });
    loadUsbDevices();
  } catch (error) {
    log(`[USB-ERROR] WebUSB selection failed: ${error.message}`, 'error');
  }
}

async function loadUsbDevices() {
  if (!navigator.usb) return;
  try {
    const devices = await navigator.usb.getDevices();
    const tableBody = document.querySelector('#usb-devices-table tbody');
    tableBody.innerHTML = '';
    
    if (devices.length === 0) {
      tableBody.innerHTML = `<tr><td colspan="4" class="empty-table" style="padding: 1.5rem;">No USB devices paired. Click scan to search.</td></tr>`;
      return;
    }

    devices.forEach(device => {
      tableBody.innerHTML += `
        <tr>
          <td><strong>${device.productName || 'Unknown USB Device'}</strong></td>
          <td style="font-family: var(--font-mono);">0x${device.vendorId.toString(16).toUpperCase().padStart(4, '0')}</td>
          <td style="font-family: var(--font-mono);">0x${device.productId.toString(16).toUpperCase().padStart(4, '0')}</td>
          <td>${device.manufacturerName || 'N/A'}</td>
        </tr>
      `;
    });
  } catch (error) {
    console.error('Error listing USB devices:', error);
  }
}

// Web Serial Printer Port Functions
async function scanSerialPorts() {
  if (!navigator.serial) {
    log('[SERIAL] Web Serial API is not supported in this browser.', 'error');
    return;
  }
  try {
    log('[SERIAL] Opening browser Serial Port chooser...', 'info');
    const port = await navigator.serial.requestPort();
    const info = port.getInfo();
    
    const vendorId = info.usbVendorId ? `0x${info.usbVendorId.toString(16).toUpperCase().padStart(4, '0')}` : 'N/A';
    const productId = info.usbProductId ? `0x${info.usbProductId.toString(16).toUpperCase().padStart(4, '0')}` : 'N/A';
    
    log(`[SERIAL-SUCCESS] Paired Serial Port`, 'success', {
      usbVendorId: vendorId,
      usbProductId: productId
    });
    loadSerialPorts();
  } catch (error) {
    log(`[SERIAL-ERROR] Web Serial selection failed: ${error.message}`, 'error');
  }
}

async function loadSerialPorts() {
  if (!navigator.serial) return;
  try {
    const ports = await navigator.serial.getPorts();
    const tableBody = document.querySelector('#serial-ports-table tbody');
    tableBody.innerHTML = '';
    
    if (ports.length === 0) {
      tableBody.innerHTML = `<tr><td colspan="4" class="empty-table" style="padding: 1.5rem;">No serial ports paired. Click scan to search.</td></tr>`;
      return;
    }

    ports.forEach((port, index) => {
      const info = port.getInfo();
      const vendorId = info.usbVendorId ? `0x${info.usbVendorId.toString(16).toUpperCase().padStart(4, '0')}` : 'N/A';
      const productId = info.usbProductId ? `0x${info.usbProductId.toString(16).toUpperCase().padStart(4, '0')}` : 'N/A';
      tableBody.innerHTML += `
        <tr>
          <td style="font-family: var(--font-mono);">Serial Port #${index + 1}</td>
          <td style="font-family: var(--font-mono);">${vendorId}</td>
          <td style="font-family: var(--font-mono);">${productId}</td>
          <td><span class="badge badge-supported">Paired</span></td>
        </tr>
      `;
    });
  } catch (error) {
    console.error('Error listing Serial ports:', error);
  }
}

// WebAuthn Registration
async function registerUser() {
  const usernameInput = document.getElementById('reg-username');
  const username = usernameInput.value.trim();
  
  if (!username) {
    log('Please enter a username to register.', 'error');
    usernameInput.focus();
    return;
  }

  const regBtn = document.getElementById('btn-register');
  regBtn.disabled = true;

  try {
    log(`[REG] Starting Client-Side Registration for user: ${username}`, 'info');
    
    // Step 1: Mock Server Option Generation
    log('[REG-1] Generating credential options locally...', 'system');
    updateFlowDiagram(
      'actor-client', 
      'flow-arrow-options', 
      '1. Generate options (Local)', 
      `<strong>Step 1: Generate Registration Options (Client-Side Mock)</strong><br>
       The application gathers configurations and generates registration parameters. A random 32-byte challenge is generated in browser memory using <code>window.crypto.getRandomValues()</code>.`,
      'cyan'
    );

    const configAttachment = document.getElementById('config-attachment').value;
    const configVerification = document.getElementById('config-verification').value;
    const configResident = document.getElementById('config-resident').value;
    const configAttestation = document.getElementById('config-attestation').value;

    const db = getLocalDb();
    let user = db[username];
    if (!user) {
      const userBuffer = window.crypto.getRandomValues(new Uint8Array(16));
      user = {
        id: bufferToBase64Url(userBuffer),
        username: username,
        credentials: []
      };
      db[username] = user;
      saveLocalDb(db);
    }

    // Generate random challenge
    const rawChallenge = window.crypto.getRandomValues(new Uint8Array(32));
    const base64Challenge = bufferToBase64Url(rawChallenge);

    // Save in mock session
    mockSession.currentChallenge = base64Challenge;
    mockSession.username = username;

    const authenticatorSelection = {};
    if (configAttachment !== 'any') authenticatorSelection.authenticatorAttachment = configAttachment;
    if (configVerification) authenticatorSelection.userVerification = configVerification;
    if (configResident) {
      authenticatorSelection.residentKey = configResident;
      authenticatorSelection.requireResidentKey = configResident === 'required';
    }

    const options = {
      challenge: base64Challenge,
      rp: {
        name: 'WebAuthn Local Playground',
        id: window.location.hostname
      },
      user: {
        id: user.id,
        name: username,
        displayName: username.split('@')[0]
      },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },   // ES256 (standard)
        { type: 'public-key', alg: -257 }  // RS256 (standard)
      ],
      timeout: 60000,
      excludeCredentials: user.credentials.map(cred => ({
        id: cred.credentialID,
        type: 'public-key',
        transports: cred.transports
      })),
      authenticatorSelection,
      attestation: configAttestation
    };

    log('[REG-2] Credential options generated.', 'input', options);

    // Step 2: Invoke Browser WebAuthn API
    log('[REG-3] Calling browser navigator.credentials.create(). Please verify on your device biometric prompt.', 'info');
    updateFlowDiagram(
      'actor-client', 
      'flow-arrow-create', 
      '2. navigator.credentials.create()', 
      `<strong>Step 2: Browser Biometric Invocation</strong><br>
       The client converts the base64url challenge and user ID into raw ArrayBuffers, then fires the browser's native WebAuthn dialog: <code>navigator.credentials.create()</code>.`,
      'cyan'
    );

    // Parse options for the native API
    const nativeOptions = { ...options };
    nativeOptions.challenge = base64UrlToBuffer(options.challenge);
    nativeOptions.user.id = base64UrlToBuffer(options.user.id);
    nativeOptions.excludeCredentials = options.excludeCredentials.map(cred => ({
      ...cred,
      id: base64UrlToBuffer(cred.id)
    }));

    // Call browser credentials.create
    const credential = await navigator.credentials.create({
      publicKey: nativeOptions
    });

    log('[REG-4] Biometric credential generated by hardware enclave.', 'output');

    // Step 3: Serialize and show browser response
    log('[REG-5] Serializing credential details for local verification...', 'system');
    updateFlowDiagram(
      'actor-client', 
      'flow-arrow-response', 
      '3. Credential Object Returned', 
      `<strong>Step 3: Biometric Credential Returned</strong><br>
       The authenticator generates a cryptographic public key, signs the challenge, and returns the public key attestation. The client receives the raw byte buffers.`,
      'cyan'
    );

    const credentialJSON = {
      id: credential.id,
      rawId: bufferToBase64Url(credential.rawId),
      type: credential.type,
      response: {
        clientDataJSON: bufferToBase64Url(credential.response.clientDataJSON),
        attestationObject: bufferToBase64Url(credential.response.attestationObject),
        transports: credential.response.getTransports ? credential.response.getTransports() : ['internal']
      }
    };

    // Decode clientDataJSON to inspect it
    const decodedClientData = JSON.parse(new TextDecoder().decode(credential.response.clientDataJSON));
    log('[REG-6] Credential serialized. Decoded clientDataJSON details shown.', 'output', {
      serializedPayload: credentialJSON,
      decodedClientDataJSON: decodedClientData
    });

    // Step 4: Verification of ClientDataJSON
    log('[REG-7] Verifying registration client data parameters locally...', 'system');
    updateFlowDiagram(
      'actor-server', 
      'flow-arrow-verify', 
      '4. Verify ClientData (Local)', 
      `<strong>Step 4: ClientData Verification</strong><br>
       The application acts as a server to verify that: the challenge matches the generated one, the origin matches the browser address bar, and the request type is <code>webauthn.create</code>.`,
      'cyan'
    );

    // Verify properties
    if (decodedClientData.challenge !== mockSession.currentChallenge) {
      throw new Error('Verification Error: Challenges mismatch.');
    }
    const currentOrigin = window.location.origin;
    if (decodedClientData.origin !== currentOrigin) {
      throw new Error(`Verification Error: Origin mismatch. Expected: ${currentOrigin}, Got: ${decodedClientData.origin}`);
    }
    if (decodedClientData.type !== 'webauthn.create') {
      throw new Error(`Verification Error: Expected type "webauthn.create", Got: ${decodedClientData.type}`);
    }

    // Save to Local DB
    const finalDb = getLocalDb();
    const finalUser = finalDb[username];
    
    const mockPublicKey = `MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE${credential.id.substring(0, 16)}...MockPublicKey`;

    const newCredential = {
      credentialID: credentialJSON.id,
      credentialPublicKey: mockPublicKey,
      counter: 0,
      transports: credentialJSON.response.transports,
      createdAt: new Date().toISOString()
    };

    finalUser.credentials.push(newCredential);
    finalDb[username] = finalUser;
    saveLocalDb(finalDb);

    // Clear session challenge
    mockSession.currentChallenge = null;

    log(`[REG-SUCCESS] Credential successfully registered and stored in localStorage.`, 'success', {
      user: finalUser,
      newCredential
    });

    updateFlowDiagram(
      null, 
      null, 
      null, 
      `<strong style="color: var(--emerald);">🎉 Local Registration Successful!</strong><br>
       User <code>${username}</code> registered a credential. The public key parameters have been saved in the browser's <code>localStorage</code>. Inspect the <strong>Database Inspector</strong> tab!`,
      'cyan'
    );

    fetchDatabase();
    document.getElementById('login-username').value = username;

  } catch (error) {
    log(`[REG-ERROR] Registration failed: ${error.message}`, 'error');
    updateFlowDiagram(
      null, 
      null, 
      null, 
      `<strong style="color: var(--rose);">❌ Registration Failed</strong><br>
       Reason: ${error.message}. Make sure your browser supports biometrics and you are running under a secure context (localhost).`,
      'cyan'
    );
  } finally {
    regBtn.disabled = false;
  }
}

// WebAuthn Authentication (Login)
async function loginUser() {
  const usernameInput = document.getElementById('login-username');
  const username = usernameInput.value.trim();

  if (!username) {
    log('Please enter a username to login.', 'error');
    usernameInput.focus();
    return;
  }

  const loginBtn = document.getElementById('btn-login');
  loginBtn.disabled = true;

  try {
    log(`[AUTH] Starting Client-Side Authentication for user: ${username}`, 'info');

    // Step 1: Generate options locally
    log('[AUTH-1] Generating authentication options locally...', 'system');
    updateFlowDiagram(
      'actor-client', 
      'flow-arrow-options', 
      '1. Retrieve credentials (Local)', 
      `<strong>Step 1: Request Authentication Options (Client-Side Mock)</strong><br>
       The application queries the local database for registered credential IDs associated with <code>${username}</code>. A random 32-byte challenge is generated.`,
      'violet'
    );

    const db = getLocalDb();
    const user = db[username];
    if (!user || user.credentials.length === 0) {
      throw new Error(`User "${username}" has no registered credentials. Please register first.`);
    }

    const rawChallenge = window.crypto.getRandomValues(new Uint8Array(32));
    const base64Challenge = bufferToBase64Url(rawChallenge);

    // Save in session
    mockSession.currentChallenge = base64Challenge;
    mockSession.username = username;

    const configVerification = document.getElementById('config-verification').value;

    const options = {
      challenge: base64Challenge,
      allowCredentials: user.credentials.map(cred => ({
        id: cred.credentialID,
        type: 'public-key',
        transports: cred.transports
      })),
      rpId: window.location.hostname,
      userVerification: configVerification || 'preferred'
    };

    log('[AUTH-2] Authentication options generated.', 'input', options);

    // Step 2: Invoke Browser WebAuthn API
    log('[AUTH-3] Calling browser navigator.credentials.get(). Please authenticate via Touch ID / Face ID.', 'info');
    updateFlowDiagram(
      'actor-client', 
      'flow-arrow-create', 
      '2. navigator.credentials.get()', 
      `<strong>Step 2: Browser Biometric Verification</strong><br>
       The browser displays the biometric prompt. It searches the hardware enclave matching the allowed credential IDs and validates user presence.`,
      'violet'
    );

    // Parse options for native API
    const nativeOptions = { ...options };
    nativeOptions.challenge = base64UrlToBuffer(options.challenge);
    nativeOptions.allowCredentials = options.allowCredentials.map(cred => ({
      ...cred,
      id: base64UrlToBuffer(cred.id)
    }));

    // Call browser credentials.get
    const credential = await navigator.credentials.get({
      publicKey: nativeOptions
    });

    log('[AUTH-4] Assertion signature generated successfully by biometrics.', 'output');

    // Step 3: Serialize response
    log('[AUTH-5] Serializing assertion signature...', 'system');
    updateFlowDiagram(
      'actor-client', 
      'flow-arrow-response', 
      '3. Signature Returned', 
      `<strong>Step 3: Signature Returned</strong><br>
       The authenticator returns a cryptographic signature of the challenge, indicating the private key was successfully accessed on the device.`,
      'violet'
    );

    const credentialJSON = {
      id: credential.id,
      rawId: bufferToBase64Url(credential.rawId),
      type: credential.type,
      response: {
        clientDataJSON: bufferToBase64Url(credential.response.clientDataJSON),
        authenticatorData: bufferToBase64Url(credential.response.authenticatorData),
        signature: bufferToBase64Url(credential.response.signature),
        userHandle: credential.response.userHandle ? bufferToBase64Url(credential.response.userHandle) : null
      }
    };

    const decodedClientData = JSON.parse(new TextDecoder().decode(credential.response.clientDataJSON));
    log('[AUTH-6] Assertion payload parsed. clientDataJSON details decoded.', 'output', {
      serializedPayload: credentialJSON,
      decodedClientDataJSON: decodedClientData
    });

    // Step 4: Verification of ClientDataJSON and signature counter simulation
    log('[AUTH-7] Verifying assertion data locally...', 'system');
    updateFlowDiagram(
      'actor-server', 
      'flow-arrow-verify', 
      '4. Verify Assertion parameters', 
      `<strong>Step 4: Signature Verification Simulation</strong><br>
       The client validates the challenge, origin, and request type. The sign counter in the mock database is incremented to simulate protection against replay attacks.`,
      'violet'
    );

    if (decodedClientData.challenge !== mockSession.currentChallenge) {
      throw new Error('Verification Error: Challenge mismatch.');
    }
    const currentOrigin = window.location.origin;
    if (decodedClientData.origin !== currentOrigin) {
      throw new Error(`Verification Error: Origin mismatch. Expected: ${currentOrigin}, Got: ${decodedClientData.origin}`);
    }
    if (decodedClientData.type !== 'webauthn.get') {
      throw new Error(`Verification Error: Expected type "webauthn.get", Got: ${decodedClientData.type}`);
    }

    // Update Counter in Database
    const finalDb = getLocalDb();
    const finalUser = finalDb[username];
    const savedCred = finalUser.credentials.find(c => c.credentialID === credential.id);
    
    if (!savedCred) {
      throw new Error('Verification Error: Credential ID not recognized.');
    }

    // Increment counter
    savedCred.counter += 1;
    finalDb[username] = finalUser;
    saveLocalDb(finalDb);

    // Clear session challenge
    mockSession.currentChallenge = null;

    log(`[AUTH-SUCCESS] User successfully authenticated! Simulating updated signature counter: ${savedCred.counter}`, 'success', {
      user: finalUser,
      activeCredential: savedCred
    });

    updateFlowDiagram(
      null, 
      null, 
      null, 
      `<strong style="color: var(--violet);">🎉 Local Authentication Successful!</strong><br>
       User <code>${username}</code> logged in successfully using biometrics. Browser verified client data parameters and simulated counter update to <code>${savedCred.counter}</code>.`,
      'violet'
    );

    fetchDatabase();

  } catch (error) {
    log(`[AUTH-ERROR] Authentication failed: ${error.message}`, 'error');
    updateFlowDiagram(
      null, 
      null, 
      null, 
      `<strong style="color: var(--rose);">❌ Authentication Failed</strong><br>
       Reason: ${error.message}. Make sure you registered this user on this browser first.`,
      'violet'
    );
  } finally {
    loginBtn.disabled = false;
  }
}

// Reset Local Database
function resetDatabase() {
  localStorage.removeItem('webauthn_db');
  log('[SYSTEM] LocalStorage database reset successfully.', 'success');
  fetchDatabase();
}

// Clear Logs
function clearLogs() {
  const container = document.getElementById('console-logs-output');
  container.innerHTML = '<div class="log-line system">[SYSTEM] Logs cleared. Waiting for user actions...</div>';
  viewJson(null);
  logsRegistry = [];
  currentLogIndex = 0;
}

// Copy JSON to clipboard
function copyJson() {
  const viewer = document.getElementById('json-output-viewer');
  const text = viewer.innerText;
  
  if (text.startsWith('Select a step') || text.startsWith('No payload')) {
    return;
  }

  navigator.clipboard.writeText(text).then(() => {
    const copyBtn = document.getElementById('btn-copy-json');
    copyBtn.innerText = 'Copied!';
    setTimeout(() => {
      copyBtn.innerText = 'Copy JSON';
    }, 2000);
  }).catch(err => {
    console.error('Copy failed:', err);
  });
}

// Bind Page Tab Events
function setupTabs() {
  const tabs = document.querySelectorAll('.tab-btn');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const targetTabId = tab.getAttribute('data-tab');
      
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      document.querySelectorAll('.tab-pane').forEach(panel => {
        panel.classList.remove('active');
        if (panel.id === `tab-${targetTabId}`) {
          panel.classList.add('active');
        }
      });

      if (targetTabId === 'database') {
        fetchDatabase();
      }
      if (targetTabId === 'hardware') {
        loadUsbDevices();
        loadSerialPorts();
      }
    });
  });
}

// Initialize Application
window.addEventListener('DOMContentLoaded', () => {
  setupTabs();
  checkBrowserSupport();
  fetchDatabase();
  loadUsbDevices();
  loadSerialPorts();

  // Event Listeners
  document.getElementById('btn-register').addEventListener('click', registerUser);
  document.getElementById('btn-login').addEventListener('click', loginUser);
  document.getElementById('btn-clear-logs').addEventListener('click', clearLogs);
  document.getElementById('btn-copy-json').addEventListener('click', copyJson);
  document.getElementById('btn-db-reset').addEventListener('click', resetDatabase);
  document.getElementById('btn-scan-usb').addEventListener('click', scanUsbDevices);
  document.getElementById('btn-scan-serial').addEventListener('click', scanSerialPorts);
  
  // Set mock server status in UI
  document.getElementById('api-status-dot').className = 'status-indicator online';
  document.getElementById('api-status-text').innerText = 'Local Mock Active';
  log('[SYSTEM] Browser-Only WebAuthn simulator initialized. Storing credentials in localStorage.', 'success');
});
