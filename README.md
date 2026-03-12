# Roadmap# RoadGuard AI

RoadGuard AI is an AI-powered platform that detects and reports road hazards such as potholes using computer vision and community contributions. The system analyzes uploaded road images using Gemini Vision and visualizes hazards on an interactive map.

---

## Features

- AI-powered road hazard detection using Gemini Vision
- Interactive hazard map using Leaflet
- Community-based hazard reporting
- Smart AI road safety summary
- Firebase Firestore for real-time data storage
- Severity classification (Low / Medium / High)
- Confidence score for AI predictions

---

## Tech Stack

- React + Vite
- TypeScript
- Firebase Firestore
- Google Gemini Vision API
- Leaflet Maps
- OpenStreetMap

---

## How It Works

1. User uploads a road image
2. Image is converted to Base64 in the browser
3. Gemini Vision analyzes the image for hazards
4. AI returns hazard type, severity, and explanation
5. The report is stored in Firebase Firestore
6. Hazards appear on the map and dashboard in real-time

---

## Project Structure

```
src/
  components/
    Dashboard.tsx
    HazardFeed.tsx
    ReportForm.tsx
    RoadMap.tsx
  services/
    gemini.ts
  firebase.ts
  App.tsx
```

---

## Environment Variables

Create a `.env` file in the root directory:

```
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_APP_ID=
VITE_GEMINI_API_KEY=
```

---

## Demo

You can test the application by uploading a road image with a pothole or damaged road surface.  
The AI will analyze the image and automatically classify the hazard.

AI Studio App Link:  
https://ai.studio/apps/c129333c-ea53-4732-91ca-89e94c32b877

PPT and Demo video link
https://drive.google.com/drive/folders/1Ws8PZt0HkC4XHjHdPTC9LHBufDsm_v5I?usp=sharing

---

## Future Improvements

- AI hazard heatmap visualization
- Real-time driver alerts for nearby hazards
- Government dashboard for infrastructure analytics
- Mobile app integration
- Automatic road condition monitoring via dashcams

---

## License

This project was developed as part of a hackathon prototype.


