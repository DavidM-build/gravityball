import React, { useState, useEffect, useRef } from "react";
import "./styles.css";
import { GoogleGenerativeAI } from "@google/generative-ai";

export default function App() {
  const [position, setPosition] = useState({ x: 50, y: 50 });
  const [velocity, setVelocity] = useState({ x: 0, y: 0 });
  const [courseLines, setCourseLines] = useState([]);
  const [isDrawing, setIsDrawing] = useState(false);
  const [startPoint, setStartPoint] = useState(null);
  const canvasRef = useRef(null);
  const animationRef = useRef(null);
  const [massFactor, setMassFactor] = useState(0.7);
  const [timer, setTimer] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [lastPosition, setLastPosition] = useState({ x: 50, y: 50 });
  const [previewLine, setPreviewLine] = useState(null);
  const [predictedPath, setPredictedPath] = useState([]);

  // AI and encryption state
  const [encFile, setEncFile] = useState(null);
  const [password, setPassword] = useState("");
  const [apiKey, setApiKey] = useState(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [geminiModel, setGeminiModel] = useState(null);
  const [error, setError] = useState(null);

  // Static detection variables
  const STATIC_THRESHOLD = 0.1;
  const STATIC_FRAME_COUNT = 5;
  const staticRef = useRef(0);

  const BASE_GRAVITY = 0.5;
  const BOUNCE = -0.7;
  const FRICTION = 0.99;
  const BALL_SIZE = 5;
  const TIME_STEP = 16.666;

  const checkLineCollision = (x, y, line) => {
    const dx = line.x2 - line.x1;
    const dy = line.y2 - line.y1;
    const lineLengthSquared = dx * dx + dy * dy;

    if (lineLengthSquared === 0) return { collision: false };

    let t = ((x - line.x1) * dx + (y - line.y1) * dy) / lineLengthSquared;
    t = Math.max(0, Math.min(1, t));

    const closestX = line.x1 + t * dx;
    const closestY = line.y1 + t * dy;

    const distX = x - closestX;
    const distY = y - closestY;
    const distSquared = distX * distX + distY * distY;

    if (distSquared <= BALL_SIZE * BALL_SIZE) {
      const dist = Math.sqrt(distSquared);
      const normalX = dist ? distX / dist : 0;
      const normalY = dist ? distY / dist : 0;
      return {
        collision: true,
        closestX: closestX + normalX * BALL_SIZE,
        closestY: closestY + normalY * BALL_SIZE,
        normalX,
        normalY,
        t,
        line,
      };
    }
    return { collision: false };
  };

  const applyGravityAndFriction = (vel) => {
    return {
      x: vel.x * FRICTION,
      y: vel.y + BASE_GRAVITY * massFactor,
    };
  };

  const handleBoundaryCollisions = (pos, vel) => {
    let newPos = { ...pos };
    let newVel = { ...vel };
    if (newPos.y > 360 - BALL_SIZE) {
      newPos.y = 360 - BALL_SIZE;
      newVel.y *= BOUNCE;
    }
    if (newPos.y < 40 + BALL_SIZE) {
      newPos.y = 40 + BALL_SIZE;
      newVel.y *= BOUNCE;
    }
    if (newPos.x > 550 - BALL_SIZE) {
      newPos.x = 550 - BALL_SIZE;
      newVel.x *= BOUNCE;
    }
    if (newPos.x < 50 + BALL_SIZE) {
      newPos.x = 50 + BALL_SIZE;
      newVel.x *= BOUNCE;
    }
    return { newPos, newVel };
  };

  const handleLineCollisions = (newPos, newVel) => {
    let resolvedPos = { ...newPos };
    let resolvedVel = { ...newVel };
    let collisionDetected = false;
    for (let i = 0; i < 2; i++) {
      let closestCollision = null;
      let minDistance = Infinity;

      for (const line of courseLines) {
        const collision = checkLineCollision(
          resolvedPos.x,
          resolvedPos.y,
          line
        );
        if (collision.collision) {
          const dist = Math.sqrt(
            (resolvedPos.x - collision.closestX) ** 2 +
              (resolvedPos.y - collision.closestY) ** 2
          );
          if (dist < minDistance) {
            minDistance = dist;
            closestCollision = collision;
          }
        }
      }
      if (closestCollision) {
        collisionDetected = true;
        resolvedPos.x = closestCollision.closestX;
        resolvedPos.y = closestCollision.closestY;

        const dx = closestCollision.line.x2 - closestCollision.line.x1;
        const dy = closestCollision.line.y2 - closestCollision.line.y1;
        const lineLength = Math.sqrt(dx * dx + dy * dy);
        const tangentX = dx / lineLength;
        const tangentY = dy / lineLength;

        const normalVel =
          resolvedVel.x * closestCollision.normalX +
          resolvedVel.y * closestCollision.normalY;
        const tangentVel = resolvedVel.x * tangentX + resolvedVel.y * tangentY;

        resolvedVel.x =
          tangentX * tangentVel * FRICTION +
          closestCollision.normalX * normalVel * BOUNCE;
        resolvedVel.y =
          tangentY * tangentVel * FRICTION +
          closestCollision.normalY * normalVel * BOUNCE;

        const slopeAngle = Math.atan2(dy, dx);
        const gravityEffect = BASE_GRAVITY * massFactor * Math.sin(slopeAngle);
        resolvedVel.x += gravityEffect * tangentX;
        resolvedVel.y += gravityEffect * tangentY;
      }
    }

    return { newPos: resolvedPos, newVel: resolvedVel, collisionDetected };
  };

  const update = () => {
    const canvas = canvasRef.current;
    if (!canvas) return; // Exit if canvas is not available
    const ctx = canvas.getContext("2d");

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw border and lines
    ctx.strokeStyle = "black";
    ctx.lineWidth = 2;
    ctx.strokeRect(50, 40, 500, 320);

    ctx.beginPath();
    courseLines.forEach((line) => {
      ctx.moveTo(line.x1, line.y1);
      ctx.lineTo(line.x2, line.y2);
    });
    ctx.stroke();

    // Apply gravity and friction
    let newVelocity = applyGravityAndFriction(velocity);

    let newPosition = {
      x: position.x + newVelocity.x,
      y: position.y + newVelocity.y,
    };
    // Check for line collisions
    let collisionResult = handleLineCollisions(newPosition, newVelocity);
    newPosition = collisionResult.newPos;
    newVelocity = collisionResult.newVel;

    // Check for boundary collisions
    let boundaryResult = handleBoundaryCollisions(newPosition, newVelocity);
    newPosition = boundaryResult.newPos;
    newVelocity = boundaryResult.newVel;

    // Static detection and timer logic
    const deltaX = Math.abs(newPosition.x - lastPosition.x);
    const deltaY = Math.abs(newPosition.y - lastPosition.y);
    const speed = Math.sqrt(deltaX ** 2 + deltaY ** 2);

    if (speed < STATIC_THRESHOLD) {
      staticRef.current++;
      if (staticRef.current >= STATIC_FRAME_COUNT) {
        setIsRunning(false);
        newVelocity = { x: 0, y: 0 };
        setVelocity(newVelocity);
      }
    } else {
      staticRef.current = 0;
      if (isRunning) {
        setTimer((prevTimer) => prevTimer + TIME_STEP);
      }
    }
    setLastPosition(newPosition);

    // Draw ball
    ctx.beginPath();
    ctx.arc(newPosition.x, newPosition.y, BALL_SIZE, 0, Math.PI * 2);
    ctx.fillStyle = "red";
    ctx.fill();

    // Draw predicted path
    ctx.beginPath();
    ctx.strokeStyle = "rgba(0, 0, 255, 0.5)";
    ctx.setLineDash([5, 5]); // Dotted line
    predictedPath.forEach((point, index) => {
      if (index === 0) {
        ctx.moveTo(point.x, point.y);
      } else {
        ctx.lineTo(point.x, point.y);
      }
    });
    ctx.stroke();
    ctx.setLineDash([]); // Reset line dash

    // Draw preview line
    if (previewLine) {
      ctx.beginPath();
      ctx.strokeStyle = "rgba(0, 0, 0, 0.5)";
      ctx.moveTo(previewLine.x1, previewLine.y1);
      ctx.lineTo(previewLine.x2, previewLine.y2);
      ctx.stroke();
    }

    setPosition(newPosition);
    setVelocity(newVelocity);

    animationRef.current = requestAnimationFrame(update);
  };

  // Function to predict the path
  const predictPath = (startX, startY, startVelocityX, startVelocityY) => {
    let simPosition = { x: startX, y: startY };
    let simVelocity = { x: startVelocityX, y: startVelocityY };
    const path = [];
    for (let i = 0; i < 400; i++) {
      // simulate 400 frames
      // Apply gravity and friction
      simVelocity = applyGravityAndFriction(simVelocity);
      let nextPosition = {
        x: simPosition.x + simVelocity.x,
        y: simPosition.y + simVelocity.y,
      };
      // Check for line collisions
      let collisionResult = handleLineCollisions(nextPosition, simVelocity);
      nextPosition = collisionResult.newPos;
      simVelocity = collisionResult.newVel;

      // Check for boundary collisions
      let boundaryResult = handleBoundaryCollisions(nextPosition, simVelocity);
      nextPosition = boundaryResult.newPos;
      simVelocity = boundaryResult.newVel;

      path.push({ x: nextPosition.x, y: nextPosition.y });
      simPosition = nextPosition;

      if (
        Math.abs(simVelocity.x) < STATIC_THRESHOLD &&
        Math.abs(simVelocity.y) < STATIC_THRESHOLD
      )
        break;
    }

    return path;
  };

  // Decryption function
  const decryptData = async (encryptedFile, password) => {
    const arrayBuffer = await encryptedFile.arrayBuffer();
    const combinedBuffer = new Uint8Array(arrayBuffer);

    if (combinedBuffer.length < 28) {
      throw new Error("Invalid encrypted file format");
    }

    const salt = combinedBuffer.slice(0, 16);
    const iv = combinedBuffer.slice(16, 28);
    const encryptedContent = combinedBuffer.slice(28);

    const encoder = new TextEncoder();
    const pwUtf8 = encoder.encode(password);

    const keyMaterial = await window.crypto.subtle.importKey(
      "raw",
      pwUtf8,
      { name: "PBKDF2" },
      false,
      ["deriveKey"]
    );

    const key = await window.crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt: salt,
        iterations: 100000,
        hash: "SHA-256",
      },
      keyMaterial,
      { name: "AES-GCM", length: 256 },
      true,
      ["decrypt"]
    );

    const decryptedContent = await window.crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv },
      key,
      encryptedContent
    );

    const decoder = new TextDecoder();
    const decryptedText = decoder.decode(decryptedContent);
    return JSON.parse(decryptedText);
  };

  // Handle API key decryption
  const handleDecryptApiKey = async () => {
    if (!encFile || !password) {
      setError("Please provide both an encrypted file and password");
      return;
    }

    setIsDecrypting(true);
    setError(null);

    try {
      const decryptedData = await decryptData(encFile, password);
      if (!decryptedData.GOOGLE_API_KEY) {
        throw new Error("Invalid API key format in encrypted file");
      }

      setApiKey(decryptedData.GOOGLE_API_KEY);
      const genAI = new GoogleGenerativeAI(decryptedData.GOOGLE_API_KEY);
      setGeminiModel(genAI.getGenerativeModel({ model: "gemini-pro" }));

      // Clear sensitive data
      setPassword("");
      setEncFile(null);
    } catch (error) {
      console.error("Decryption failed:", error);
      setError(
        "Failed to decrypt API key. Please check your password and try again."
      );
    } finally {
      setIsDecrypting(false);
    }
  };

  useEffect(() => {
    if (apiKey && canvasRef.current) {
      animationRef.current = requestAnimationFrame(update);
    }
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [position, velocity, courseLines, massFactor, apiKey, predictedPath]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (isDrawing && startPoint && canvas) {
      const rect = canvas.getBoundingClientRect();
      const handleMouseMove = (e) => {
        setPreviewLine({
          x1: startPoint.x,
          y1: startPoint.y,
          x2: e.clientX - rect.left,
          y2: e.clientY - rect.top,
        });
      };
      window.addEventListener("mousemove", handleMouseMove);

      return () => {
        window.removeEventListener("mousemove", handleMouseMove);
        setPreviewLine(null);
      };
    }
  }, [isDrawing, startPoint]);

  const handleMouseDown = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    setIsDrawing(true);
    setStartPoint({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
  };

  const handleMouseUp = (e) => {
    if (isDrawing && startPoint) {
      const canvas = canvasRef.current;
      const rect = canvas.getBoundingClientRect();
      setCourseLines([
        ...courseLines,
        {
          x1: startPoint.x,
          y1: startPoint.y,
          x2: e.clientX - rect.left,
          y2: e.clientY - rect.top,
        },
      ]);
    }
    setIsDrawing(false);
    setStartPoint(null);
    setPreviewLine(null);
  };

  const handleRightClick = (e) => {
    e.preventDefault();
    const rect = canvasRef.current.getBoundingClientRect();
    const newX = e.clientX - rect.left;
    const newY = e.clientY - rect.top;
    setPosition({
      x: newX,
      y: newY,
    });
    setVelocity({ x: 0, y: 0 });
    setPredictedPath(predictPath(newX, newY, 0, 0));
    setIsRunning(true);
    setTimer(0); // Reset timer on right-click
  };

  const formatTime = (time) => {
    const seconds = Math.floor(time / 1000) % 60;
    const milliseconds = Math.floor((time % 1000) / 10);
    return `${seconds}:${String(milliseconds).padStart(2, "0")}`;
  };

  return (
    <div className="App">
      {apiKey ? (
        <>
          <canvas
            ref={canvasRef}
            width={600}
            height={400}
            onMouseDown={handleMouseDown}
            onMouseUp={handleMouseUp}
            onContextMenu={handleRightClick}
            style={{
              border: "2px solid black",
              background: "white",
              cursor: isDrawing ? "crosshair" : "default",
            }}
          />
          <div>
            <label htmlFor="massSlider">
              Mass Factor: {massFactor.toFixed(1)}{" "}
            </label>
            <input
              type="range"
              id="massSlider"
              min="0.1"
              max="3"
              step="0.1"
              value={massFactor}
              onChange={(e) => setMassFactor(parseFloat(e.target.value))}
            />
            <p>Timer: {formatTime(timer)}</p>
            <button onClick={() => setCourseLines([])}>Clear Lines</button>
            <p>
              Left click and drag to draw lines. Right click to place the ball.
            </p>
          </div>
        </>
      ) : (
        <div>
          <h2>Decrypt API Key</h2>
          <input
            type="file"
            accept=".enc"
            onChange={(e) => setEncFile(e.target.files?.[0] || null)}
          />
          <input
            type="password"
            placeholder="Enter password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button onClick={handleDecryptApiKey} disabled={isDecrypting}>
            {isDecrypting ? "Decrypting..." : "Decrypt"}
          </button>
          {error && <p style={{ color: "red" }}>{error}</p>}
        </div>
      )}
    </div>
  );
}
