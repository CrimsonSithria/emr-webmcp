import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import EmrWebmcp from './emr-webmcp.component';

const Root: React.FC = () => (
  <BrowserRouter basename={window.getOpenmrsSpaBase()}>
    <Routes>
      <Route path="emr-webmcp" element={<EmrWebmcp />} />
    </Routes>
  </BrowserRouter>
);

export default Root;
